import pytest
from backend import app as service, licensing
from backend.tests.test_app import AUTH

@pytest.fixture
def preview(monkeypatch):
    monkeypatch.setenv('NIGHTBREW_ENV', 'local-preview')
    monkeypatch.setenv('NIGHTBREW_LOCAL_PREVIEW', '1')
    monkeypatch.setenv('NIGHTBREW_ENFORCE_LICENSE', '0')

def test_local_preview_is_explicit_and_does_not_contact_paid_services(client, preview):
    value = client.get('/license', headers=AUTH).json()
    assert not value['required']
    assert value['claims']['environment'] == 'local_preview'
    assert value['claims']['verified'] is False
    with pytest.raises(ValueError, match='no cloud'):
        licensing.remote('/checkout', {'product':'Business'})

@pytest.mark.parametrize('mode', ['CLOUD_ONLY', 'HYBRID'])
def test_preview_rejects_cloud_and_hybrid_even_with_consent(client, preview, mode):
    body={'message':'private local test','mode':mode,'cloud_consent':True}
    assert client.post('/chat',headers=AUTH,json=body).status_code == 403
    assert client.post('/ai/estimate',headers=AUTH,json=body).status_code == 403

def test_preview_cannot_enable_cloud_in_policy(client, preview):
    assert client.put('/settings/ai',headers=AUTH,json={'cloud_allowed':True}).status_code == 403
    assert client.put('/settings/ai',headers=AUTH,json={'billing_source':'INCLUDED'}).status_code == 403
