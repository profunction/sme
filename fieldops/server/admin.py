"""Provision an organization locally; no public bootstrap endpoint or default password."""
import argparse
import getpass
import re
from .app import audit, identifier, now
from .db import connect, initialize
from .security import hash_password


def provision(code, name, email, engineer_name, password, industry='General'):
    if not re.fullmatch(r'[A-Z0-9_-]{2,32}', code) or len(password)<12:
        raise ValueError('Use an uppercase company code and a password of at least 12 characters')
    initialize()
    cid,uid=identifier(),identifier()
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT INTO companies VALUES(?,?,?,?,?)',(cid,code,name,industry,now()))
        conn.execute('INSERT INTO users(id,company_id,email,name,role,password_hash) VALUES(?,?,?,?,?,?)',(uid,cid,email.lower(),engineer_name,'owner',hash_password(password)))
        audit(conn,{'id':uid,'company_id':cid},'company_created',cid);conn.commit()
    return {'company_id':cid,'user_id':uid,'company_code':code}


def main():
    parser=argparse.ArgumentParser(description='Create the first FieldOps company owner')
    parser.add_argument('--code',required=True);parser.add_argument('--name',required=True)
    parser.add_argument('--email',required=True);parser.add_argument('--owner-name',required=True)
    parser.add_argument('--industry',default='General')
    args=parser.parse_args()
    password=getpass.getpass('New password (12+ characters): ')
    if password!=getpass.getpass('Confirm password: '):raise SystemExit('Passwords do not match')
    print(provision(args.code.upper(),args.name,args.email,args.owner_name,password,args.industry))


if __name__=='__main__':main()
