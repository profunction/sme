import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nightbrew_fieldops/main.dart';
void main(){
 testWidgets('first screen explains company connection and validates required fields',(tester)async{
  await tester.pumpWidget(MaterialApp(home:LoginScreen(onLogin:(a,b,c,d)async{})));
  expect(find.text('Company API server'),findsOneWidget);
  expect(find.text('Company code'),findsOneWidget);
  expect(find.text('Password'),findsOneWidget);
  await tester.ensureVisible(find.text('Sign in to company'));await tester.tap(find.text('Sign in to company'));await tester.pump();
  expect(find.text('Enter your company server'),findsOneWidget);
 });
}
