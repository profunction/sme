"""Desktop verification of short-lived, device-bound Ed25519 grants from a separate authority."""
import base64
import hashlib
import json
import os
import platform
import time
import uuid
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from backend import credentials, store


def device_id():
    material=f'{platform.system()}|{platform.machine()}|{platform.node()}|{uuid.getnode()}'
    return hashlib.sha256(material.encode()).hexdigest()


def required(): return os.getenv('NIGHTBREW_ENFORCE_LICENSE')=='1'


def decode(value): return base64.urlsafe_b64decode(value+'='*(-len(value)%4))


def verify(token, public_key, device=None, now=None):
    try:
        encoded,signature=token.split('.')
        Ed25519PublicKey.from_public_bytes(decode(public_key)).verify(decode(signature),encoded.encode())
        data=json.loads(decode(encoded))
        timestamp=time.time() if now is None else now
        if data['iss']!='nightbrew-license-authority' or data['aud']!='nightbrew-desktop' or data['version']!=1: raise ValueError('Invalid grant issuer')
        if data['device_id']!=(device or device_id()) or not data['nbf']<=timestamp<data['exp']: raise ValueError('License expired or belongs to another computer')
        if data['environment']=='mock' and os.getenv('NIGHTBREW_ALLOW_MOCK_LICENSE')!='1': raise ValueError('Mock grants are disabled')
        if data['plan'] not in ('Starter','Business','Enterprise') or not isinstance(data['employee_limit'],int) or data['employee_limit']<1: raise ValueError('Invalid license claims')
        return data
    except (InvalidSignature,ValueError,KeyError,TypeError,UnicodeError) as exc:
        raise ValueError('Untrusted, expired, malformed or wrong-device license') from exc


def enforce(connect):
    if not required(): return {'environment':'development','plan':'Development','employee_limit':100,'verified':False}
    key=os.getenv('NIGHTBREW_LICENSE_PUBLIC_KEY','')
    with connect() as db: token=store.get(db,'license_grant','')
    if not key or not token: raise ValueError('Activate a valid license from the trusted licensing backend')
    return verify(token,key)


def account_key():
    key=os.getenv('NIGHTBREW_LICENSE_ACCOUNT_KEY')
    if key: return key
    if platform.system()=='Windows': return credentials.windows_vault().get_password('NightBrew','license-account-key')
    return None


def remote(path, body=None):
    base=os.getenv('NIGHTBREW_LICENSE_URL','').rstrip('/')
    parsed=urlsplit(base)
    test=os.getenv('NIGHTBREW_ENV')=='test' and parsed.hostname in ('127.0.0.1','localhost')
    if (parsed.scheme!='https' and not test) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError('Configure a trusted HTTPS licensing backend URL')
    key=account_key()
    if not key: raise ValueError('Configure the license account credential securely')
    try:
        with httpx.Client(timeout=30,follow_redirects=False,trust_env=True) as client:
            response=client.request('POST' if body is not None else 'GET',base+path,json=body,headers={'Authorization':'Bearer '+key})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError,ValueError): raise ValueError('Licensing backend unavailable or rejected the operation; check subscription, credits and device allowance') from None


def activate(connect):
    result=remote('/activate',{'device_id':device_id()})
    claims=verify(result['grant'],os.getenv('NIGHTBREW_LICENSE_PUBLIC_KEY',''))
    with connect() as db:
        store.put(db,'license_grant',result['grant']);store.audit(db,'license_activated',claims['plan'])
    return claims


def reserve_task(connect, identifier, employee_id=None):
    if not required(): return
    enforce(connect)
    remote('/quota/reserve',{'device_id':device_id(),'operation_id':identifier,'employee_id':employee_id})


def reserve_seat(connect, identifier, active):
    if not required(): return
    enforce(connect)
    remote('/employees/register',{'employee_id':identifier,'active':active,'device_id':device_id()})


def included_inference(connect, request, system_text):
    enforce(connect)
    return remote('/inference',{'device_id':device_id(),'request_id':uuid.uuid4().hex,'message':request.message,'system_text':system_text,'cloud_consent':request.cloud_consent})
