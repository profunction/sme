from concurrent.futures import ThreadPoolExecutor

import pytest

from backend import ai, hardware, store
from backend.tests.test_app import AUTH, client


def test_hybrid_local_and_privacy():
    policy = ai.Policy(cloud_allowed=True)
    measured = {'model':'small', 'local_plan_recommended':True}
    assert ai.select(ai.Chat(message='hi',mode='HYBRID'),policy,measured,'small')=='LOCAL_ONLY'
    with pytest.raises(ValueError,match='consent'):
        ai.select(ai.Chat(message='hi',mode='HYBRID',complexity='complex'),policy,measured,'small')
    with pytest.raises(ValueError,match='Private'):
        ai.select(ai.Chat(message='hi',mode='CLOUD_ONLY',privacy='private',cloud_consent=True),policy,measured,'small')
    with pytest.raises(ValueError,match='benchmarked'):
        ai.select(ai.Chat(message='hi',mode='HYBRID',privacy='private'),policy,None,'small')


def test_cloud_disabled_even_with_consent():
    with pytest.raises(ValueError,match='disabled'):
        ai.select(ai.Chat(message='hi',mode='CLOUD_ONLY',cloud_consent=True),ai.Policy(),None,'small')


def test_reservations_are_atomic(tmp_path):
    connect=lambda: store.open_db(tmp_path/'usage.db')
    policy=ai.Policy(cloud_allowed=True,pricing_confirmed=True,credit_balance_usd=0.1,monthly_limit_usd=0.1,input_usd_per_million=1,output_usd_per_million=100,max_output_tokens=512)
    with connect() as db: store.put(db,'ai_policy',policy.model_dump())
    def reserve(_):
        try: return ai.reserve(connect,'model',ai.Chat(message='hi'),policy)[0]
        except ValueError: return None
    with ThreadPoolExecutor(max_workers=3) as pool: results=list(pool.map(reserve,range(3)))
    assert sum(r is not None for r in results)==1
    identifier=next(r for r in results if r)
    ai.settle(connect,identifier,{'prompt_tokens':10,'completion_tokens':20},policy,True)
    with connect() as db:
        assert db.execute('SELECT status FROM usage').fetchone()[0]=='reported'
        assert store.get(db,'ai_policy')['credit_balance_usd']==pytest.approx(0.1-0.00201)


def test_uncertain_failure_keeps_reservation(tmp_path):
    connect=lambda: store.open_db(tmp_path/'usage.db')
    policy=ai.Policy(pricing_confirmed=True,credit_balance_usd=1,input_usd_per_million=1)
    with connect() as db: store.put(db,'ai_policy',policy.model_dump())
    identifier, amount=ai.reserve(connect,'m',ai.Chat(message='hi'),policy)
    ai.settle(connect,identifier,None,policy,False)
    with connect() as db:
        assert store.get(db,'ai_policy')['credit_balance_usd']==pytest.approx(1-amount)
        assert db.execute('SELECT status FROM usage').fetchone()[0]=='failed_estimated'


def test_hardware_does_not_assume_gpu_compatibility(monkeypatch):
    def unavailable(*args,**kwargs): raise OSError('not installed')
    monkeypatch.setattr(hardware.subprocess,'run',unavailable)
    class Offline:
        def __init__(self,**kw): raise hardware.httpx.ConnectError('offline')
    monkeypatch.setattr(hardware.httpx,'Client',Offline)
    info=hardware.inspect()
    assert info['ram_bytes']>0
    assert info['available_storage_bytes']>0
    assert info['gpu_detection']=='unknown'
    assert info['local_plan_recommended'] is False
    assert info['models']==[]


def test_benchmark_requires_real_measurement(monkeypatch):
    import httpx
    class Provider:
        def __init__(self,**kw): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def post(self,url,**kw): return httpx.Response(200,json={'response':'answer','eval_count':20,'eval_duration':2_000_000_000},request=httpx.Request('POST',url))
    monkeypatch.setattr(hardware.httpx,'Client',Provider)
    assert hardware.benchmark('small')['tokens_per_second']==10


def test_windows_vault_is_not_plaintext_fallback(client):
    import sys
    if sys.platform!='win32':
        assert client.put('/settings/cloud-key',headers=AUTH,json={'key':'test-not-real'}).status_code==503
