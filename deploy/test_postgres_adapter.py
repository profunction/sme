from billing_service.postgres import Adapter, Row, rows


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


def test_row_factory_accepts_commands_without_a_result_description():
    class Command:
        description = None
    assert rows(Command())(()) == {}


def test_legacy_integer_flags_do_not_bind_as_postgres_boolean():
    connection = Capture()
    Adapter(connection).execute("UPDATE accounts SET active=? WHERE id=?", (True, "a"))
    assert connection.params == (1, "a")
    assert type(connection.params[0]) is int
