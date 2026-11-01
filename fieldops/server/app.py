"""FieldOps Phase 1: tenant-scoped field records, append-only notes and deterministic PDF."""
import hashlib
import io
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from html import escape
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from .db import connect, initialize
from .models import Login, UserInput, CustomerInput, SiteInput, EquipmentInput, WorkOrderInput, WorkOrderUpdate, NoteInput
from .security import admin, current_user, editable, hash_password, limiter, management, verify_password


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier():
    return str(uuid.uuid4())


def audit(conn, user, action, entity):
    conn.execute('INSERT INTO audit(company_id,actor_id,action,entity_id,occurred_at) VALUES(?,?,?,?,?)',(user['company_id'],user['id'],action,entity,now()))



@asynccontextmanager
async def lifespan(_app):
    initialize()
    yield


app = FastAPI(title='NightBrew FieldOps AI',version='0.1.0',lifespan=lifespan)


@app.middleware('http')
async def boundaries(request: Request, call_next):
    try:
        limiter.check(('request',request.client.host if request.client else 'unknown'),300)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 96*1024:
                return JSONResponse({'detail':'Request body exceeds 96 KiB'},status_code=413)
        request._body = bytes(body)
    except HTTPException as exc:
        return JSONResponse({'detail':exc.detail},status_code=exc.status_code)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error(_request, _exc):
    return JSONResponse({'detail':'Record conflicts with existing data or an invalid company reference'},status_code=409)


@app.get('/health')
def health():
    return {'status':'ok','product':'NightBrew FieldOps AI','version':'0.1.0','ai_enabled':False}


@app.post('/auth/login')
def login(body: Login, request: Request):
    limiter.check(('login',request.client.host if request.client else 'unknown',body.company_code.upper()),8)
    with connect() as conn:
        row = conn.execute('SELECT u.* FROM users u JOIN companies c ON c.id=u.company_id WHERE c.code=? AND u.email=? AND u.active=1',(body.company_code.upper(),body.email)).fetchone()
        # A missing account still performs a password derivation to reduce timing disclosure.
        digest = row['password_hash'] if row else hash_password('non-user-timing-placeholder')
        valid = verify_password(body.password.get_secret_value(),digest)
        if not row or not valid:
            raise HTTPException(401,'Company code, email or password is incorrect')
        token = secrets.token_urlsafe(48)
        expires = int(time.time())+24*60*60
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('DELETE FROM sessions WHERE expires_at<=?',(int(time.time()),))
        conn.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),row['id'],expires))
        user = {key:row[key] for key in ('id','company_id','email','name','role')}
        audit(conn,user,'login',row['id'])
        conn.commit()
    return {'token':token,'expires_at':expires,'user':user}


@app.post('/auth/logout',status_code=204)
def logout(request: Request,user=Depends(current_user)):
    digest = hashlib.sha256(request.headers['authorization'][7:].encode()).hexdigest()
    with connect() as conn:
        conn.execute('DELETE FROM sessions WHERE digest=?',(digest,))
        audit(conn,user,'logout',user['id'])
    return Response(status_code=204)


@app.get('/me')
def me(user=Depends(current_user)):
    with connect() as conn:
        company = dict(conn.execute('SELECT id,code,name,industry FROM companies WHERE id=?',(user['company_id'],)).fetchone())
    return {'user':user,'company':company,'phase':'Phase 1 — no AI diagnoses or manual citations generated'}


@app.get('/users')
def users(user=Depends(current_user)):
    with connect() as conn:
        if user['role']=='engineer':
            return [user]
        return [dict(r) for r in conn.execute('SELECT id,name,email,role,active FROM users WHERE company_id=?',(user['company_id'],))]


@app.post('/users',status_code=201)
def create_user(body: UserInput,user=Depends(current_user)):
    admin(user)
    if body.role == 'administrator' and user['role'] != 'owner':
        raise HTTPException(403,'Only a company owner can create an administrator')
    uid=identifier()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT INTO users(id,company_id,email,name,role,password_hash) VALUES(?,?,?,?,?,?)',(uid,user['company_id'],body.email.lower(),body.name,body.role,hash_password(body.password.get_secret_value())))
        audit(conn,user,'user_created',uid)
        conn.commit()
    return {'id':uid,'name':body.name,'role':body.role}


def scoped_records(conn, user, table):
    if user['role'] != 'engineer':
        return [dict(r) for r in conn.execute(f'SELECT * FROM {table} WHERE company_id=? ORDER BY rowid DESC LIMIT 500',(user['company_id'],))]
    filters = {
        'customers':'id IN (SELECT s.customer_id FROM sites s JOIN equipment e ON e.company_id=s.company_id AND e.site_id=s.id JOIN work_orders w ON w.company_id=e.company_id AND w.equipment_id=e.id WHERE w.company_id=? AND w.engineer_id=?)',
        'sites':'id IN (SELECT e.site_id FROM equipment e JOIN work_orders w ON w.company_id=e.company_id AND w.equipment_id=e.id WHERE w.company_id=? AND w.engineer_id=?)',
        'equipment':'id IN (SELECT equipment_id FROM work_orders WHERE company_id=? AND engineer_id=?)',
    }
    return [dict(r) for r in conn.execute(f'SELECT * FROM {table} WHERE company_id=? AND {filters[table]} ORDER BY rowid DESC LIMIT 500',(user['company_id'],user['company_id'],user['id']))]


@app.get('/customers')
def customers(user=Depends(current_user)):
    with connect() as conn:return scoped_records(conn,user,'customers')


@app.post('/customers',status_code=201)
def create_customer(body: CustomerInput,user=Depends(current_user)):
    management(user)
    cid=identifier()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT INTO customers(id,company_id,name,contact) VALUES(?,?,?,?)',(cid,user['company_id'],body.name,body.contact))
        audit(conn,user,'customer_created',cid)
        conn.commit()
    return {'id':cid,**body.model_dump()}


def reference(conn,table,key,user):
    row=conn.execute(f'SELECT * FROM {table} WHERE id=? AND company_id=?',(key,user['company_id'])).fetchone()
    if not row:raise HTTPException(404,'Record not found')
    return dict(row)


@app.get('/sites')
def sites(user=Depends(current_user)):
    with connect() as conn:return scoped_records(conn,user,'sites')


@app.post('/sites',status_code=201)
def create_site(body: SiteInput,user=Depends(current_user)):
    management(user)
    sid=identifier()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        reference(conn,'customers',body.customer_id,user)
        conn.execute('INSERT INTO sites(id,company_id,customer_id,name,address) VALUES(?,?,?,?,?)',(sid,user['company_id'],body.customer_id,body.name,body.address))
        audit(conn,user,'site_created',sid);conn.commit()
    return {'id':sid,**body.model_dump()}


@app.get('/equipment')
def equipment(user=Depends(current_user)):
    with connect() as conn:return scoped_records(conn,user,'equipment')


@app.post('/equipment',status_code=201)
def create_equipment(body: EquipmentInput,user=Depends(current_user)):
    management(user)
    eid=identifier()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE');reference(conn,'sites',body.site_id,user)
        columns=['id','company_id',*body.model_dump().keys()]
        conn.execute(f'INSERT INTO equipment({",".join(columns)}) VALUES({",".join("?" for _ in columns)})',(eid,user['company_id'],*body.model_dump().values()))
        audit(conn,user,'equipment_created',eid);conn.commit()
    return {'id':eid,**body.model_dump()}


WO_SQL='''SELECT w.*,e.manufacturer,e.model,e.serial_number,e.room,e.firmware,s.id site_id,s.name site_name,s.address,c.id customer_id,c.name customer_name,u.name engineer_name FROM work_orders w JOIN equipment e ON e.company_id=w.company_id AND e.id=w.equipment_id JOIN sites s ON s.company_id=e.company_id AND s.id=e.site_id JOIN customers c ON c.company_id=s.company_id AND c.id=s.customer_id LEFT JOIN users u ON u.company_id=w.company_id AND u.id=w.engineer_id'''


def orders(conn,user):
    sql=WO_SQL+' WHERE w.company_id=?'
    args=[user['company_id']]
    if user['role']=='engineer':sql+=' AND w.engineer_id=?';args.append(user['id'])
    return [dict(r) for r in conn.execute(sql+' ORDER BY w.updated_at DESC,w.id LIMIT 500',args)]


def order(conn, wid, user):
    sql=WO_SQL+' WHERE w.company_id=? AND w.id=?'
    args=[user['company_id'],wid]
    if user['role']=='engineer':sql+=' AND w.engineer_id=?';args.append(user['id'])
    row=conn.execute(sql,args).fetchone()
    if not row:raise HTTPException(404,'Work order not found')
    return dict(row)


def engineer(conn,uid,user):
    row=reference(conn,'users',uid,user)
    if row['role'] not in ('engineer','supervisor') or not row['active']:
        raise HTTPException(422,'Assign an active engineer or supervisor in this company')


@app.get('/work-orders')
def work_orders(user=Depends(current_user)):
    with connect() as conn:return orders(conn,user)


@app.get('/work-orders/{wid}')
def get_order(wid:str,user=Depends(current_user)):
    with connect() as conn:return order(conn,wid,user)


@app.post('/work-orders',status_code=201)
def create_order(body: WorkOrderInput,user=Depends(current_user)):
    management(user)
    wid=identifier();stamp=now();number='WO-'+wid[:8].upper()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE');reference(conn,'equipment',body.equipment_id,user)
        if body.engineer_id:engineer(conn,body.engineer_id,user)
        conn.execute('INSERT INTO work_orders(id,company_id,equipment_id,engineer_id,number,title,priority,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(wid,user['company_id'],body.equipment_id,body.engineer_id,number,body.title,body.priority,'Assigned' if body.engineer_id else 'Open',stamp,stamp))
        audit(conn,user,'work_order_created',wid);conn.commit()
        return order(conn,wid,user)


TRANSITIONS={'Open':{'Assigned'},'Assigned':{'Open','In Progress'},'In Progress':{'Waiting for Parts','Pending Customer','Completed'},'Waiting for Parts':{'In Progress'},'Pending Customer':{'In Progress'},'Completed':{'In Progress','Closed'},'Closed':set()}


@app.put('/work-orders/{wid}')
def update_order(wid:str,body:WorkOrderUpdate,user=Depends(current_user)):
    editable(user)
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE');existing=order(conn,wid,user)
        if existing['version']!=body.expected_version:raise HTTPException(409,{'message':'Server record changed; refresh and review before retrying','current_version':existing['version']})
        if existing['status']=='Closed':raise HTTPException(409,'Closed work orders are immutable')
        if body.status!=existing['status'] and body.status not in TRANSITIONS[existing['status']]:raise HTTPException(422,'Invalid work order status transition')
        assigned=existing['engineer_id']
        if 'engineer_id' in body.model_fields_set and body.engineer_id != assigned:
            management(user)
            if body.engineer_id:engineer(conn,body.engineer_id,user)
            assigned=body.engineer_id
        if body.status not in ('Open',) and not assigned:raise HTTPException(422,'Assign an engineer before starting work')
        if body.status=='Closed':management(user)
        if body.status=='Completed':
            latest=conn.execute('SELECT outcome FROM service_notes WHERE company_id=? AND work_order_id=? ORDER BY rowid DESC LIMIT 1',(user['company_id'],wid)).fetchone()
            if not latest or not latest['outcome'].strip():raise HTTPException(422,'Record an engineer-confirmed outcome before marking completed')
        values={k:(getattr(body,k).isoformat() if getattr(body,k) is not None else existing[k]) for k in ('arrived_at','work_started_at','work_ended_at')}
        if values['work_ended_at'] and not values['work_started_at']:raise HTTPException(422,'A work end time requires a start time')
        if values['work_ended_at'] and datetime.fromisoformat(values['work_ended_at'])<datetime.fromisoformat(values['work_started_at']):raise HTTPException(422,'Work cannot end before it starts')
        conn.execute('UPDATE work_orders SET status=?,engineer_id=?,arrived_at=?,work_started_at=?,work_ended_at=?,version=version+1,updated_at=? WHERE company_id=? AND id=? AND version=?',(body.status,assigned,values['arrived_at'],values['work_started_at'],values['work_ended_at'],now(),user['company_id'],wid,body.expected_version))
        audit(conn,user,'work_order_updated',wid);conn.commit();return order(conn,wid,user)


@app.get('/work-orders/{wid}/notes')
def notes(wid:str,user=Depends(current_user)):
    with connect() as conn:
        order(conn,wid,user)
        return [dict(r) for r in conn.execute('SELECT * FROM service_notes WHERE company_id=? AND work_order_id=? ORDER BY rowid',(user['company_id'],wid))]


@app.post('/work-orders/{wid}/notes',status_code=201)
def create_note(wid:str,body:NoteInput,user=Depends(current_user)):
    editable(user)
    if not any((body.initial_condition,body.investigation,body.outcome,body.follow_up)):raise HTTPException(422,'At least one observation is required')
    fingerprint=hashlib.sha256((wid+'\n'+json.dumps(body.model_dump(mode='json'),sort_keys=True)).encode()).hexdigest()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE');work=order(conn,wid,user)
        previous=conn.execute('SELECT fingerprint,result FROM mutations WHERE company_id=? AND actor_id=? AND mutation_id=?',(user['company_id'],user['id'],body.mutation_id)).fetchone()
        if previous:
            if previous['fingerprint']!=fingerprint:raise HTTPException(409,'Mutation ID reused with different content')
            return json.loads(previous['result'])
        if work['status']=='Closed':raise HTTPException(409,'Closed work orders are immutable')
        count=conn.execute('SELECT COUNT(*) FROM service_notes WHERE company_id=? AND work_order_id=?',(user['company_id'],wid)).fetchone()[0]
        if count>=200:raise HTTPException(409,'Work order reached the bounded 200-note limit; create a follow-up work order')
        if work['version']!=body.expected_version:raise HTTPException(409,{'message':'Conflict: local note retained; refresh the work order and explicitly rebase the draft','current_version':work['version']})
        nid=identifier();stamp=now()
        conn.execute('INSERT INTO service_notes VALUES(?,?,?,?,?,?,?,?,?,?)',(nid,user['company_id'],wid,user['id'],body.initial_condition,body.investigation,body.outcome,body.follow_up,body.recorded_at.isoformat(),stamp))
        conn.execute('UPDATE work_orders SET version=version+1,updated_at=? WHERE company_id=? AND id=?',(stamp,user['company_id'],wid))
        result={'id':nid,'work_order_id':wid,'work_order_version':work['version']+1}
        conn.execute('INSERT INTO mutations VALUES(?,?,?,?,?)',(user['company_id'],user['id'],body.mutation_id,fingerprint,json.dumps(result)))
        audit(conn,user,'service_note_added',nid);conn.commit();return result


@app.get('/equipment/{eid}/history')
def history(eid:str,user=Depends(current_user)):
    with connect() as conn:
        allowed={r['id'] for r in scoped_records(conn,user,'equipment')}
        if eid not in allowed:raise HTTPException(404,'Equipment not found')
        return [w for w in orders(conn,user) if w['equipment_id']==eid]


@app.get('/snapshot')
def snapshot(user=Depends(current_user)):
    with connect() as conn:
        conn.execute('BEGIN')
        work=orders(conn,user);visible={w['id'] for w in work}
        observations=[dict(r) for r in conn.execute('SELECT * FROM service_notes WHERE company_id=? ORDER BY rowid DESC LIMIT 2000',(user['company_id'],)) if r['work_order_id'] in visible]
        company=dict(conn.execute('SELECT id,code,name,industry FROM companies WHERE id=?',(user['company_id'],)).fetchone())
        result={'user':user,'company':company,'customers':scoped_records(conn,user,'customers'),'sites':scoped_records(conn,user,'sites'),'equipment':scoped_records(conn,user,'equipment'),'work_orders':work,'notes':observations,'downloaded_at':now(),'limits':{'records_per_collection':500,'notes':2000},'scope':'Visible records only; this is not a full-company backup'}
        conn.commit();return result


@app.get('/work-orders/{wid}/report.pdf')
def report(wid:str,user=Depends(current_user)):
    limiter.check(('report',user['id']),20)
    with connect() as conn:
        conn.execute('BEGIN');work=order(conn,wid,user)
        company=dict(conn.execute('SELECT * FROM companies WHERE id=?',(user['company_id'],)).fetchone())
        observations=[dict(r) for r in conn.execute('SELECT n.*,u.name engineer_name FROM service_notes n JOIN users u ON u.id=n.engineer_id AND u.company_id=n.company_id WHERE n.company_id=? AND n.work_order_id=? ORDER BY n.rowid',(user['company_id'],wid))]
        audit(conn,user,'report_exported',wid);conn.commit()
    output=io.BytesIO()
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    styles=getSampleStyleSheet()
    for name in ('Title','Heading2','BodyText'):
        styles[name].fontName='STSong-Light'
        styles[name].wordWrap='CJK'
    def paragraph(value, style='BodyText'):
        return Paragraph(escape(str(value or 'Requires engineer confirmation')).replace('\n','<br/>'),styles[style])
    story=[paragraph('NightBrew FieldOps AI — Service Report','Title'),paragraph(company['name']),paragraph('FINAL RECORD' if work['status']=='Closed' else 'DRAFT — review required'),Spacer(1,15)]
    for label,key in [('Work order','number'),('Issue','title'),('Customer','customer_name'),('Site','site_name'),('Room','room'),('Manufacturer','manufacturer'),('Model','model'),('Serial number','serial_number'),('Engineer assigned','engineer_name'),('Status','status'),('Arrival','arrived_at'),('Work start','work_started_at'),('Work end','work_ended_at')]:
        story.append(paragraph(f'{label}: {work[key] or "Requires engineer confirmation"}'))
    story.extend([Spacer(1,12),paragraph(f'Record revision: {work["version"]}; export time (not service time): {now()}')])
    if not observations:
        observations=[{k:'' for k in ('initial_condition','investigation','outcome','follow_up')}]
    for idx,note in enumerate(observations,1):
        if len(observations)>1:story.append(paragraph(f'Service note {idx}','Heading2'))
        if note.get('recorded_at'):story.append(paragraph(f'Engineer: {note["engineer_name"]} | Recorded: {note["recorded_at"]}'))
        for title,key in [('Initial Condition','initial_condition'),('Investigation','investigation'),('Outcome','outcome'),('Follow Up','follow_up')]:
            story.extend([paragraph(title,'Heading2'),paragraph(note[key])])
    story.extend([Spacer(1,18),paragraph('Parts used, measurements, photos, signatures and customer acknowledgement: requires engineer confirmation unless explicitly recorded above. No AI diagnosis or manufacturer instructions have been generated.'),paragraph('Safety: only qualified personnel may perform hazardous work. Do not bypass protective systems or interlocks.')])
    SimpleDocTemplate(output,title='Service Report',author=company['name']).build(story)
    return Response(output.getvalue(),media_type='application/pdf',headers={'Content-Disposition':f'attachment; filename="{work["number"]}-v{work["version"]}.pdf"'})


@app.get('/audit')
def audit_log(user=Depends(current_user)):
    management(user)
    with connect() as conn:return [dict(r) for r in conn.execute('SELECT * FROM audit WHERE company_id=? ORDER BY id DESC LIMIT 200',(user['company_id'],))]


@app.get('/plans')
def plans(user=Depends(current_user)):
    admin(user)
    config=json.loads(Path(__file__).with_name('plans.json').read_text())
    return {**config,'mode':'mock-foundation','prices_not_payment_authorization':True,'billing_enabled':False}
