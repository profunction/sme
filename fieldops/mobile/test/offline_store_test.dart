import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nightbrew_fieldops/store.dart';
import 'package:nightbrew_fieldops/api.dart';

void main(){
 setUpAll(sqfliteFfiInit);
 test('SQLite notes survive restart and account scopes do not leak',()async{
  final dir=Directory.systemTemp.createTempSync('fieldops-test-');
  final path='${dir.path}/fieldops.sqlite';
  var db=await FieldStore.open(path:path,factory:databaseFactoryFfi);
  final scope=accountScope('https://alpha.example','company-a','engineer-a');
  var store=FieldStore(db,scope);
  await store.saveSnapshot({'work_orders':[{'id':'w1','version':1}]});
  await store.queueNote('w1',{'mutation_id':'mutation-1234567890','expected_version':1,'outcome':'Still requires investigation'});
  await db.close();
  db=await FieldStore.open(path:path,factory:databaseFactoryFfi);store=FieldStore(db,scope);
  expect((await store.drafts()).length,1);
  expect((await store.snapshot())!['work_orders'][0]['id'],'w1');
  expect(await FieldStore(db,accountScope('https://beta.example','company-b','engineer-b')).snapshot(),isNull);
  expect(await FieldStore(db,accountScope('https://beta.example','company-b','engineer-b')).drafts(),isEmpty);
  await db.close();dir.deleteSync(recursive:true);
 });
 test('conflicts preserve exact local facts and require explicit rebasing',()async{
  final db=await FieldStore.open(path:inMemoryDatabasePath,factory:databaseFactoryFfi);
  final store=FieldStore(db,'tenant-user');
  await store.queueNote('w1',{'mutation_id':'mutation-1234567890','expected_version':1,'outcome':'Not repaired'});
  final api=FieldApi(Uri.parse('https://company.example'),token:'placeholder',client:MockClient((request)async{
   expect(request.followRedirects,false);
   if(request.method=='POST')return http.Response(jsonEncode({'detail':{'message':'Version conflict','current_version':4}}),409);
   return http.Response(jsonEncode({'work_orders':[{'id':'w1','version':4}]}),200);
  }));
  await SyncEngine(store,api).sync();
  final conflict=(await store.drafts()).single;
  expect(conflict['state'],'conflict');expect(jsonDecode(conflict['body'] as String)['outcome'],'Not repaired');
  await store.rebase(conflict['id'] as String,4);
  final rebased=(await store.drafts()).single;
  expect(rebased['state'],'pending');expect(jsonDecode(rebased['body'] as String)['expected_version'],4);
  expect(rebased['id'],isNot(conflict['id']));
  api.close();await db.close();
 });
 test('acknowledged notes are removed while network failures keep drafts',()async{
  final db=await FieldStore.open(path:inMemoryDatabasePath,factory:databaseFactoryFfi);
  final store=FieldStore(db,'tenant-user');
  await store.queueNote('w1',{'mutation_id':'mutation-1234567890','expected_version':1});
  final failed=FieldApi(Uri.parse('https://company.example'),client:MockClient((r)async=>throw const SocketException('offline')));
  await expectLater(SyncEngine(store,failed).sync(),throwsA(isA<SocketException>()));expect((await store.drafts()).length,1);failed.close();
  final ok=FieldApi(Uri.parse('https://company.example'),client:MockClient((r)async=>http.Response(jsonEncode(r.method=='POST'?{'id':'note1','work_order_version':2}:{'work_orders':[]}),200)));
  expect(await SyncEngine(store,ok).sync(),1);expect(await store.drafts(),isEmpty);ok.close();await db.close();
 });
 test('HTTPS and explicit emulator development boundaries',(){
  expect(()=>validateServer('http://customer-server.example'),throwsFormatException);
  expect(()=>validateServer('https://user:secret@customer.example'),throwsFormatException);
  expect(()=>validateServer('http://10.0.2.2:8787'),throwsFormatException);
  expect(validateServer('http://10.0.2.2:8787',allowDevelopmentHttp:true).port,8787);
 });
}
