from billing_service.postgres import Adapter, Row


class Capture:
    def execute(self, sql, params=()):
        self.sql, self.params = sql, params
        return self


def test_gateway_credit_settlement_and_atomic_write_translation():
    connection = Capture()
    adapter = Adapter(connection)
    adapter.execute('UPDATE accounts SET credits=MAX(0,credits+?) WHERE id=?', (0.25, 'account'))
    assert connection.sql == 'UPDATE accounts SET credits=GREATEST(0,credits+%s) WHERE id=%s'
    assert connection.params == (0.25, 'account')
    adapter.execute('BEGIN IMMEDIATE')
    assert 'pg_advisory_xact_lock' in connection.sql
    adapter.execute('INSERT OR IGNORE INTO devices VALUES(?,?)', ('a', 'd'))
    assert connection.sql.endswith('ON CONFLICT DO NOTHING')


def test_authority_row_supports_named_and_positional_access():
    row = Row([('credits', 1.25), ('account', 'a')])
    assert row[0] == row['credits'] == 1.25
