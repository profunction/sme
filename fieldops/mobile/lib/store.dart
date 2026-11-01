import 'dart:convert';
import 'dart:math';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as paths;
import 'api.dart';

String newMutationId() => List.generate(24, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
String accountScope(String origin, String company, String user) => base64Url.encode(utf8.encode('$origin|$company|$user'));

class FieldStore {
  final Database db;
  final String scope;
  FieldStore(this.db, this.scope);
  static Future<Database> open({String? path, DatabaseFactory? factory}) async {
    final f = factory ?? databaseFactory;
    final target = path ?? paths.join(await f.getDatabasesPath(), 'nightbrew_fieldops_v1.sqlite');
    return f.openDatabase(target, options: OpenDatabaseOptions(version: 1, onCreate: (db, _) async {
      await db.execute('CREATE TABLE snapshots(scope TEXT PRIMARY KEY, json TEXT NOT NULL)');
      await db.execute('CREATE TABLE outbox(scope TEXT NOT NULL, id TEXT NOT NULL, work_order_id TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT "pending", error TEXT NOT NULL DEFAULT "", PRIMARY KEY(scope,id))');
    }));
  }
  Future<Map<String, dynamic>?> snapshot() async {
    final rows = await db.query('snapshots', where: 'scope=?', whereArgs: [scope]);
    return rows.isEmpty ? null : Map<String, dynamic>.from(jsonDecode(rows.first['json'] as String));
  }
  Future<void> saveSnapshot(Map<String, dynamic> data) async {
    await db.insert('snapshots', {'scope': scope, 'json': jsonEncode(data)}, conflictAlgorithm: ConflictAlgorithm.replace);
  }
  Future<void> commitSynchronized(Map<String, dynamic> data, List<String> acknowledged) async {
    await db.transaction((t) async {
      await t.insert('snapshots', {'scope': scope, 'json': jsonEncode(data)}, conflictAlgorithm: ConflictAlgorithm.replace);
      for (final id in acknowledged) {
        await t.delete('outbox', where: 'scope=? AND id=?', whereArgs: [scope, id]);
      }
    });
  }
  Future<void> queueNote(String workOrderId, Map<String, dynamic> body) async {
    final id = body['mutation_id'] as String;
    if (jsonEncode(body).length > 40000) throw FormatException('Note is too large. Split it into separate observations.');
    await db.insert('outbox', {'scope': scope, 'id': id, 'work_order_id': workOrderId, 'body': jsonEncode(body), 'state': 'pending', 'error': ''});
  }
  Future<List<Map<String, Object?>>> drafts() => db.query('outbox', where: 'scope=?', whereArgs: [scope], orderBy: 'rowid');
  Future<void> clear() async {
    await db.transaction((t) async {
      await t.delete('snapshots', where: 'scope=?', whereArgs: [scope]);
      await t.delete('outbox', where: 'scope=?', whereArgs: [scope]);
    });
  }
  Future<void> rebase(String id, int version) async {
    final rows = await db.query('outbox', where: 'scope=? AND id=?', whereArgs: [scope, id]);
    if (rows.isEmpty) return;
    final body = Map<String, dynamic>.from(jsonDecode(rows.first['body'] as String));
    final replacement = newMutationId();
    body['expected_version'] = version;
    body['mutation_id'] = replacement;
    await db.transaction((t) async {
      await t.delete('outbox', where: 'scope=? AND id=?', whereArgs: [scope, id]);
      await t.insert('outbox', {'scope': scope, 'id': replacement, 'work_order_id': rows.first['work_order_id'], 'body': jsonEncode(body), 'state': 'pending', 'error': ''});
    });
  }
}

class SyncEngine {
  final FieldStore store;
  final FieldApi api;
  bool _running = false;
  SyncEngine(this.store, this.api);
  Future<int> sync() async {
    if (_running) return 0;
    _running = true;
    var sent = 0;
    final acknowledged = <String>[];
    final blocked = <String>{};
    try {
      for (final row in await store.drafts()) {
        final wid = row['work_order_id'] as String;
        if (row['state'] != 'pending' || blocked.contains(wid)) { blocked.add(wid); continue; }
        try {
          await api.json('/work-orders/$wid/notes', method: 'POST', body: jsonDecode(row['body'] as String));
          acknowledged.add(row['id'] as String);
          sent++;
        } on ApiException catch (error) {
          if (error.status == 401 || error.status == 429 || error.status >= 500) rethrow;
          await store.db.update('outbox', {'state': error.status == 409 ? 'conflict' : 'rejected', 'error': error.message}, where: 'scope=? AND id=?', whereArgs: [store.scope, row['id']]);
          blocked.add(wid);
        }
      }
      final snapshot = Map<String, dynamic>.from(await api.json('/snapshot'));
      await store.commitSynchronized(snapshot, acknowledged);
      return sent;
    } finally { _running = false; }
  }
}
