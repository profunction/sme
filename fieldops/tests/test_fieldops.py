import io
import sqlite3
from datetime import datetime,timezone

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader
from fieldops.server import app as service
from fieldops.server.admin import provision
from fieldops.server.db import connect
from fieldops.server.security import limiter


@pytest.fixture
def env(tmp_path,monkeypatch):
    monkeypatch.setenv('FIELDOPS_DB',str(tmp_path/'test.sqlite3'))
    limiter.entries.clear()
    a=provision('ALPHA','Alpha Service','owner@alpha.test','A Owner','test-password-123','General')
    b=provision('BETA','Beta Service','owner@beta.test','B Owner','test-password-123','HVAC')
    with TestClient(service.app) as client:
        def login(code,email):
            r=client.post('/auth/login',json={'company_code':code,'email':email,'password':'test-password-123'})
            assert r.status_code==200,r.text
            return {'Authorization':'Bearer '+r.json()['token']}
        ah,bh=login('ALPHA','owner@alpha.test'),login('BETA','owner@beta.test')
        yield client,ah,bh,a,b


def setup_records(client,headers,model='Codec EQ'):
    def post(path,body):
        r=client.post(path,headers=headers,json=body);assert r.status_code==201,r.text;return r.json()
    customer=post('/customers',{'name':'Customer A','contact':'Service desk'})
    site=post('/sites',{'customer_id':customer['id'],'name':'Site 1','address':'Office'})
    equip=post('/equipment',{'site_id':site['id'],'manufacturer':'Sample vendor','model':model,'room':'Room 2','serial_number':'ACTUAL-123'})
    engineer=post('/users',{'name':'Engineer A','email':'engineer@test.example','role':'engineer','password':'test-password-123'})
    work=post('/work-orders',{'equipment_id':equip['id'],'title':'Reported HDMI input issue; diagnosis unconfirmed','engineer_id':engineer['id']})
    token=client.post('/auth/login',json={'company_code':'ALPHA','email':'engineer@test.example','password':'test-password-123'}).json()['token']
    return customer,site,equip,work,{'Authorization':'Bearer '+token}


def note(version=1,mutation='mutation-00000000001',**kw):
    return {'expected_version':version,'mutation_id':mutation,'recorded_at':datetime.now(timezone.utc).isoformat(),'initial_condition':'Display has no signal','investigation':'Cable checked by engineer','outcome':'Issue remains under investigation','follow_up':'Confirm equipment settings',**kw}


def test_authentication_and_revocation(env):
    c,ah,*_=env
    assert c.get('/customers').status_code==401
    assert c.post('/auth/login',json={'company_code':'ALPHA','email':'owner@alpha.test','password':'wrong'}).status_code==401
    assert c.post('/auth/logout',headers=ah).status_code==204
    assert c.get('/me',headers=ah).status_code==401
    with connect() as db:
        assert db.execute('SELECT password_hash FROM users LIMIT 1').fetchone()[0].startswith('scrypt$')


def test_company_isolation_and_foreign_references(env):
    c,ah,bh,*_=env
    customer,site,equip,work,eh=setup_records(c,ah)
    assert c.get('/customers',headers=bh).json()==[]
    assert c.get('/work-orders/'+work['id'],headers=bh).status_code==404
    assert c.get('/work-orders/'+work['id']+'/report.pdf',headers=bh).status_code==404
    assert c.post('/sites',headers=bh,json={'customer_id':customer['id'],'name':'Cross company'}).status_code==404
    assert c.post('/work-orders',headers=bh,json={'equipment_id':equip['id'],'title':'Cross company'}).status_code==404
    with connect() as db:
        beta=db.execute("SELECT id FROM companies WHERE code='BETA'").fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError):db.execute('INSERT INTO sites VALUES(?,?,?,?,?)',('forged',beta,customer['id'],'forged',''))


def test_engineer_assignment_and_viewer_read_only(env):
    c,ah,_,*_=env
    *_,work,eh=setup_records(c,ah)
    assert len(c.get('/work-orders',headers=eh).json())==1
    assert c.post('/customers',headers=eh,json={'name':'Forbidden'}).status_code==403
    assert c.post('/users',headers=eh,json={'email':'x@y.z','name':'bad','password':'test-password-123'}).status_code==403
    r=c.post('/users',headers=ah,json={'email':'viewer@test.example','name':'Viewer','role':'viewer','password':'test-password-123'})
    assert r.status_code==201
    vh={'Authorization':'Bearer '+c.post('/auth/login',json={'company_code':'ALPHA','email':'viewer@test.example','password':'test-password-123'}).json()['token']}
    assert c.get('/work-orders',headers=vh).status_code==200
    assert c.post('/work-orders/'+work['id']+'/notes',headers=vh,json=note()).status_code==403
    assert c.get('/plans',headers=vh).status_code==403


def test_offline_replay_is_idempotent_and_conflicts_are_explicit(env):
    c,ah,*_=env
    *_,work,eh=setup_records(c,ah)
    url='/work-orders/'+work['id']+'/notes';body=note()
    first=c.post(url,headers=eh,json=body);assert first.status_code==201
    assert c.post(url,headers=eh,json=body).json()==first.json()
    changed={**body,'outcome':'Different content'}
    assert c.post(url,headers=eh,json=changed).status_code==409
    stale=c.post(url,headers=eh,json=note(mutation='mutation-stale-00001'))
    assert stale.status_code==409
    assert stale.json()['detail']['current_version']==2
    assert len(c.get(url,headers=eh).json())==1
    assert c.get('/work-orders/'+work['id'],headers=eh).json()['version']==2


@pytest.mark.parametrize('model',['Codec EQ','Poly X70','Crestron NVX','Bosch DICENTIS','Q-SYS Core','Generic HVAC'])
def test_report_has_real_sections_and_no_fabricated_outcome(env,model):
    c,ah,*_=env
    *_,work,eh=setup_records(c,ah,model)
    response=c.get('/work-orders/'+work['id']+'/report.pdf',headers=eh)
    assert response.content.startswith(b'%PDF-')
    text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages)
    for expected in ['Initial Condition','Investigation','Outcome','Follow Up','Requires engineer confirmation','DRAFT',model,'ACTUAL-123']:
        assert expected in text
    assert 'System working normally' not in text


def test_work_order_lifecycle_and_maintenance_history(env):
    c,ah,*_=env
    _,_,equip,work,eh=setup_records(c,ah)
    url='/work-orders/'+work['id']
    bad=c.put(url,headers=eh,json={'expected_version':1,'status':'Completed'})
    assert bad.status_code==422
    assert c.put(url,headers=eh,json={'expected_version':1,'status':'In Progress'}).status_code==200
    assert c.put(url,headers=eh,json={'expected_version':2,'status':'Completed'}).status_code==422
    assert c.post(url+'/notes',headers=eh,json=note(2)).status_code==201
    assert c.put(url,headers=eh,json={'expected_version':2,'status':'Completed'}).status_code==409
    assert c.put(url,headers=eh,json={'expected_version':3,'status':'Completed'}).status_code==200
    assert c.put(url,headers=eh,json={'expected_version':4,'status':'Closed'}).status_code==403
    assert c.put(url,headers=ah,json={'expected_version':4,'status':'Closed'}).status_code==200
    assert c.post(url+'/notes',headers=eh,json=note(5,mutation='mutation-closed-0001')).status_code==409
    assert c.get('/equipment/'+equip['id']+'/history',headers=eh).json()[0]['status']=='Closed'


def test_snapshot_and_input_boundaries(env):
    c,ah,bh,*_=env
    *_,work,eh=setup_records(c,ah)
    snapshot=c.get('/snapshot',headers=eh).json()
    assert snapshot['work_orders'][0]['id']==work['id']
    assert 'password_hash' not in str(snapshot)
    assert c.get('/snapshot',headers=bh).json()['work_orders']==[]
    assert c.post('/customers',headers=ah,json={'name':'x','company_id':'forged'}).status_code==422
    r=c.post('/customers',headers={**ah,'Content-Type':'application/json'},content=b' '*(100*1024))
    assert r.status_code==413
