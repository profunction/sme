"""Actual local task/approval boundaries; native UI operations are mocked here."""
import io
import time

from openpyxl import Workbook, load_workbook

from backend import macos_automation, store
from backend.tests.test_app import AUTH


def finished(client, identifier):
    for _ in range(200):
        row = next(task for task in client.get('/tasks', headers=AUTH).json() if task['id'] == identifier)
        if row['status'] in ('completed', 'failed', 'cancelled'):
            assert row['status'] == 'completed', row
            return row
        time.sleep(.02)
    raise AssertionError('owned task did not finish')


def test_capabilities_are_authenticated_and_do_not_request_native_permissions(client):
    assert client.get('/automation/capabilities').status_code == 401
    result = client.get('/automation/capabilities', headers=AUTH)
    assert result.status_code == 200
    assert result.json()['automatic_sending'] is False
    assert result.json()['excel']['available'] is True


def test_mac_policy_is_validated_and_keeps_other_permissions(client):
    current = client.get('/automation/policy', headers=AUTH).json()
    assert client.put('/automation/policy', headers=AUTH,
                      json={**current, 'mac_applications': {'fixture': 'com.apple.Terminal'}}).status_code == 422
    saved = client.put('/automation/policy', headers=AUTH,
                       json={**current, 'mac_applications': {'fixture': 'com.nightbrew.fixture'}})
    assert saved.status_code == 200
    assert saved.json()['browser_hosts'] == current['browser_hosts']


def test_excel_fill_needs_exact_approval_and_never_overwrites_source(client):
    book = Workbook(); book.active.title = 'Form'; book.active['A1'] = 'Original'
    output = io.BytesIO(); book.save(output); book.close()
    source = output.getvalue()
    uploaded = client.post('/files?filename=fill-template.xlsx', headers=AUTH, content=source).json()
    inspection = client.post('/tasks', headers=AUTH,
        json={'tool': 'excel.inspect', 'payload': {'file_id': uploaded['id']}})
    info = finished(client, inspection.json()['id'])['result']['spreadsheet']
    values = {'file_id': uploaded['id'], 'source_sha256': info['source_sha256'],
              'values': [{'sheet': 'Form', 'cell': 'A1', 'kind': 'text', 'value': 'Confirmed'}]}
    preview = client.post('/tasks', headers=AUTH, json={'tool': 'excel.preview', 'payload': values})
    checked = finished(client, preview.json()['id'])['result']['spreadsheet_preview']
    task = client.post('/tasks', headers=AUTH,
        json={'tool': 'excel.fill', 'payload': {**values, 'preview_hash': checked['preview_hash']}})
    assert task.status_code == 201 and task.json()['status'] == 'pending_approval'
    assert len(client.get('/files', headers=AUTH).json()) == 1
    assert client.post('/tasks/' + task.json()['id'] + '/approve', headers=AUTH).status_code == 200
    completed = finished(client, task.json()['id'])
    generated = client.get('/files/' + completed['result']['file']['id'], headers=AUTH).content
    read = load_workbook(io.BytesIO(generated)); assert read['Form']['A1'].value == 'Confirmed'; read.close()
    assert client.get('/files/' + uploaded['id'], headers=AUTH).content == source


def test_mac_inspection_needs_approval_and_permission_errors_are_actionable(client, monkeypatch):
    policy = client.get('/automation/policy', headers=AUTH).json()
    assert client.put('/automation/policy', headers=AUTH,
        json={**policy, 'mac_applications': {'fixture': 'com.nightbrew.fixture'}}).status_code == 200
    calls = []
    def denied(request, checkpoint):
        calls.append(request)
        raise ValueError('Allow NightBrew in macOS Privacy & Security → Accessibility and Automation, then try again')
    monkeypatch.setattr(macos_automation, 'invoke', denied)
    created = client.post('/tasks', headers=AUTH,
        json={'tool': 'macos.inspect', 'payload': {'application_id': 'fixture', 'title': 'Owned fixture'}})
    assert created.status_code == 201 and created.json()['status'] == 'pending_approval'
    assert calls == []
    client.post('/tasks/' + created.json()['id'] + '/approve', headers=AUTH)
    for _ in range(100):
        row = next(item for item in client.get('/tasks', headers=AUTH).json() if item['id'] == created.json()['id'])
        if row['status'] == 'failed': break
        time.sleep(.02)
    assert row['status'] == 'failed'
    assert 'Accessibility' in row['error'] and '辅助功能' in row['error']
    assert len(calls) == 1
