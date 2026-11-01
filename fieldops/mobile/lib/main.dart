import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:printing/printing.dart';
import 'api.dart';
import 'store.dart';

const navy = Color(0xFF13243D);
const gold = Color(0xFFD9B777);
const statuses = ['Open','Assigned','In Progress','Waiting for Parts','Pending Customer','Completed','Closed'];
const transitions = <String,List<String>>{'Open':['Assigned'],'Assigned':['Open','In Progress'],'In Progress':['Waiting for Parts','Pending Customer','Completed'],'Waiting for Parts':['In Progress'],'Pending Customer':['In Progress'],'Completed':['In Progress','Closed'],'Closed':[]};
const sections = <String,String>{'initial_condition':'Initial Condition','investigation':'Investigation','outcome':'Outcome','follow_up':'Follow Up'};
void main() { WidgetsFlutterBinding.ensureInitialized(); runApp(const FieldOpsApp()); }

class FieldOpsApp extends StatelessWidget {
  const FieldOpsApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title:'NightBrew FieldOps AI',debugShowCheckedModeBanner:false,
    theme: ThemeData(useMaterial3:true,colorScheme:ColorScheme.fromSeed(seedColor:navy,primary:navy,secondary:gold),scaffoldBackgroundColor:const Color(0xFFF4F6FA),appBarTheme:const AppBarTheme(backgroundColor:navy,foregroundColor:Colors.white),inputDecorationTheme:const InputDecorationTheme(border:OutlineInputBorder(),filled:true,fillColor:Colors.white)),
    home:const SessionGate(),
  );
}

class SessionGate extends StatefulWidget {
  const SessionGate({super.key});
  @override State<SessionGate> createState()=>_SessionGateState();
}
class _SessionGateState extends State<SessionGate> {
  final secure=const FlutterSecureStorage();
  Map<String,dynamic>? session;
  bool loading=true;
  String error='';
  @override void initState(){super.initState(); restore();}
  Future<void> restore() async {
    try {
      final value=await secure.read(key:'fieldops.session.v1');
      if(value!=null){final data=Map<String,dynamic>.from(jsonDecode(value)); if((data['expires_at'] as int)>DateTime.now().millisecondsSinceEpoch~/1000) session=data; else error='Session expired. Sign in again; local drafts remain on this device.';}
    } catch(_){error='Secure session could not be restored. Please sign in.';}
    if(mounted)setState(()=>loading=false);
  }
  Future<void> login(String origin,String company,String email,String password) async {
    final uri=validateServer(origin,allowDevelopmentHttp:const bool.fromEnvironment('FIELDOPS_ALLOW_HTTP'));
    final api=FieldApi(uri);
    try {
      final value=Map<String,dynamic>.from(await api.json('/auth/login',method:'POST',body:{'company_code':company,'email':email,'password':password}));
      value['origin']=uri.toString();
      await secure.write(key:'fieldops.session.v1',value:jsonEncode(value));
      if(mounted)setState(()=>session=value);
    } finally {api.close();}
  }
  @override Widget build(BuildContext context){
    if(loading)return const Scaffold(body:Center(child:CircularProgressIndicator()));
    if(session==null)return LoginScreen(onLogin:login,initialError:error);
    return Workspace(key:ValueKey('${session!['origin']}|${session!['user']['id']}'),session:session!,onLogout:()async{await secure.delete(key:'fieldops.session.v1');if(mounted)setState(()=>session=null);});
  }
}

class LoginScreen extends StatefulWidget {
 final Future<void> Function(String,String,String,String) onLogin;
 final String initialError;
 const LoginScreen({super.key,required this.onLogin,this.initialError=''});
 @override State<LoginScreen> createState()=>_LoginScreenState();
}
class _LoginScreenState extends State<LoginScreen>{
 final form=GlobalKey<FormState>();
 final server=TextEditingController(text:const String.fromEnvironment('FIELDOPS_API_URL'));
 final company=TextEditingController(),email=TextEditingController(),password=TextEditingController();
 bool busy=false;String error='';
 @override void dispose(){server.dispose();company.dispose();email.dispose();password.dispose();super.dispose();}
 @override Widget build(BuildContext context)=>Scaffold(body:SafeArea(child:Center(child:SingleChildScrollView(padding:const EdgeInsets.all(24),child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:440),child:Form(key:form,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
 const Icon(Icons.engineering_outlined,size:60,color:navy),const SizedBox(height:20),Text('NightBrew\nFieldOps AI',style:Theme.of(context).textTheme.headlineLarge?.copyWith(fontWeight:FontWeight.bold,color:navy)),const SizedBox(height:12),const Text('Your field records. Ready when you are.\nPhase 1 · service records, not AI diagnoses.'),const SizedBox(height:28),
 TextFormField(controller:server,decoration:const InputDecoration(labelText:'Company API server',hintText:'https://fieldops.your-company.com'),keyboardType:TextInputType.url,validator:(s)=>s==null||s.trim().isEmpty?'Enter your company server':null),const SizedBox(height:14),
 TextFormField(controller:company,decoration:const InputDecoration(labelText:'Company code'),validator:(s)=>s==null||s.trim().isEmpty?'Enter your company code':null),const SizedBox(height:14),
 TextFormField(controller:email,decoration:const InputDecoration(labelText:'Email'),keyboardType:TextInputType.emailAddress,validator:(s)=>s==null||!s.contains('@')?'Enter your email':null),const SizedBox(height:14),
 TextFormField(controller:password,decoration:const InputDecoration(labelText:'Password'),obscureText:true,autocorrect:false,enableSuggestions:false,validator:(s)=>s==null||s.isEmpty?'Enter your password':null),const SizedBox(height:18),
 if(error.isNotEmpty||widget.initialError.isNotEmpty) Text(error.isNotEmpty?error:widget.initialError,style:const TextStyle(color:Colors.red)),
 FilledButton(onPressed:busy?null:()async{if(!form.currentState!.validate())return;setState((){busy=true;error='';});try{await widget.onLogin(server.text.trim(),company.text.trim(),email.text.trim(),password.text);password.clear();}catch(e){if(mounted)setState(()=>error='$e');}finally{if(mounted)setState(()=>busy=false);}},child:Text(busy?'Signing in…':'Sign in to company')),
 const SizedBox(height:18),const Text('Ask your company administrator for the server, company code and account. No default password is bundled. Online sign-in is required before work can be cached for offline use.',style:TextStyle(fontSize:12,color:Colors.blueGrey)),
 ])))))));
}

class Workspace extends StatefulWidget {
 final Map<String,dynamic> session;final Future<void> Function() onLogout;
 const Workspace({super.key,required this.session,required this.onLogout});
 @override State<Workspace> createState()=>_WorkspaceState();
}
class _WorkspaceState extends State<Workspace> with WidgetsBindingObserver {
 late final FieldApi api;
 FieldStore? store;SyncEngine? syncer;Map<String,dynamic>? data;
 List<Map<String,Object?>> drafts=[];
 bool busy=false,online=false,autoSync=true;String message='Loading cached workspace…';int tab=0;
 Timer? timer;
 Map<String,dynamic> get user=>Map<String,dynamic>.from(widget.session['user']);
 bool get manager=>['owner','administrator','supervisor'].contains(user['role']);
 List<Map<String,dynamic>> rows(String name)=>((data?[name] as List?)??[]).map((v)=>Map<String,dynamic>.from(v)).toList();
 @override void initState(){super.initState();WidgetsBinding.instance.addObserver(this);api=FieldApi(Uri.parse(widget.session['origin']),token:widget.session['token']);init();}
 Future<void> init()async{
  try{final db=await FieldStore.open();store=FieldStore(db,accountScope(widget.session['origin'],user['company_id'],user['id']));syncer=SyncEngine(store!,api);data=await store!.snapshot();drafts=await store!.drafts();if(mounted)setState(()=>message='Cached records ready. Checking server…');await sync();timer=Timer.periodic(const Duration(seconds:30),(_){if(autoSync)sync(silent:true);});}catch(e){if(mounted)setState(()=>message='Local storage error: $e');}
 }
 @override void didChangeAppLifecycleState(AppLifecycleState state){if(state==AppLifecycleState.resumed&&autoSync)sync(silent:true);}
 Future<void> sync({bool silent=false})async{
  if(busy||syncer==null)return;
  if(!mounted)return;setState(()=>busy=true);
  try{final count=await syncer!.sync();data=await store!.snapshot();drafts=await store!.drafts();if(mounted)setState((){online=true;message='Online · $count notes synchronized. Cached ${data?['downloaded_at']??''}';});}
  catch(e){drafts=await store!.drafts();if(mounted)setState((){online=false;message='Offline / sync unavailable. Saved drafts remain on this device. $e';});}
  finally{if(mounted)setState(()=>busy=false);}
 }
 @override void dispose(){timer?.cancel();WidgetsBinding.instance.removeObserver(this);api.close();final db=store?.db;if(db!=null)db.close();super.dispose();}
 Future<void> formDialog(String title,Map<String,String> fields,Future<void> Function(Map<String,String>) save,{Map<String,List<MapEntry<String,String>>>> choices=const {}})async{
  final controllers={for(final key in fields.keys)key:TextEditingController()};
  final selected=<String,String>{};String error='';bool saving=false;
  await showDialog<void>(context:context,builder:(ctx)=>StatefulBuilder(builder:(ctx,update)=>AlertDialog(title:Text(title),content:SingleChildScrollView(child:SizedBox(width:420,child:Column(mainAxisSize:MainAxisSize.min,children:[for(final item in fields.entries)Padding(padding:const EdgeInsets.only(bottom:14),child:choices.containsKey(item.key)?DropdownButtonFormField<String>(isExpanded:true,decoration:InputDecoration(labelText:item.value),items:choices[item.key]!.map((e)=>DropdownMenuItem(value:e.key,child:Text(e.value,overflow:TextOverflow.ellipsis))).toList(),onChanged:(value)=>selected[item.key]=value??''):TextField(controller:controllers[item.key],maxLength:250,decoration:InputDecoration(labelText:item.value))),if(error.isNotEmpty)Text(error,style:const TextStyle(color:Colors.red))]))),actions:[TextButton(onPressed:saving?null:()=>Navigator.pop(ctx),child:const Text('Cancel')),FilledButton(onPressed:saving?null:()async{
   final values={for(final e in controllers.entries)e.key:e.value.text.trim(),...selected};
   if(values.values.any((v)=>v.isEmpty)){update(()=>error='Complete all fields.');return;}
   update(()=>saving=true);try{await save(values);if(ctx.mounted)Navigator.pop(ctx);await sync();}catch(e){if(ctx.mounted)update(()=>error='$e');}finally{if(ctx.mounted)update(()=>saving=false);}
  },child:Text(saving?'Saving…':'Save'))])));
  for(final c in controllers.values)c.dispose();
 }
 Future<void> create(String kind)async{
  if(!online){setState(()=>message='Creating company records requires a live connection. Existing assigned records and notes work offline.');return;}
  if(kind=='customer')await formDialog('New customer',{'name':'Customer name','contact':'Service contact'},(v)async{await api.json('/customers',method:'POST',body:v);});
  if(kind=='site')await formDialog('New site',{'customer_id':'Customer','name':'Site name','address':'Address'},(v)async{await api.json('/sites',method:'POST',body:v);},choices:{'customer_id':rows('customers').map((r)=>MapEntry('${r['id']}','${r['name']}')).toList()});
  if(kind=='equipment')await formDialog('Add equipment',{'site_id':'Site','manufacturer':'Manufacturer','model':'Model','serial_number':'Serial number','room':'Room / location','category':'Industry / category'},(v)async{await api.json('/equipment',method:'POST',body:v);},choices:{'site_id':rows('sites').map((r)=>MapEntry('${r['id']}','${r['name']}')).toList()});
  if(kind=='work'){
   try{final people=(await api.json('/users') as List).map((v)=>Map<String,dynamic>.from(v)).where((p)=>['engineer','supervisor'].contains(p['role'])&&p['active']==1).toList();
   await formDialog('Create & assign work order',{'equipment_id':'Equipment','title':'Reported issue (not diagnosis)','engineer_id':'Assigned engineer','priority':'Priority'},(v)async{await api.json('/work-orders',method:'POST',body:v);},choices:{'equipment_id':rows('equipment').map((r)=>MapEntry('${r['id']}','${r['manufacturer']} ${r['model']} · ${r['serial_number']}')).toList(),'engineer_id':people.map((r)=>MapEntry('${r['id']}','${r['name']}')).toList(),'priority':['Low','Normal','High','Urgent'].map((p)=>MapEntry(p,p)).toList()});
   }catch(e){if(mounted)setState(()=>message='$e');}
  }
  if(kind=='engineer')await formDialog('Create engineer account',{'name':'Engineer name','email':'Email','password':'Initial password (12+ characters)'},(v)async{await api.json('/users',method:'POST',body:{...v,'role':'engineer'});});
 }
 Future<void> openWork(Map<String,dynamic> work)async{
  if(store==null)return;
  await Navigator.push(context,MaterialPageRoute<void>(builder:(_)=>WorkDetail(work:work,api:api,store:store!,online:online,manager:manager,cachedNotes:rows('notes').where((n)=>n['work_order_id']==work['id']).toList(),onSync:sync)));
  if(mounted){data=await store!.snapshot();drafts=await store!.drafts();setState((){});}
 }
 Future<void> signOut()async{
  final confirmed=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(title:const Text('Sign out and clear this account’s cache?'),content:Text('${drafts.length} unsent drafts are stored locally. Signing out deletes this account’s cached records and drafts. Sync first to keep them.'),actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('Keep working')),FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('Delete local cache & sign out'))]));
  if(confirmed!=true)return;
  try{await api.json('/auth/logout',method:'POST');}catch(_){}
  await store?.clear();await widget.onLogout();
 }
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('NightBrew FieldOps'),actions:[IconButton(tooltip:'Synchronize',onPressed:busy?null:sync,icon:busy?const SizedBox(width:20,height:20,child:CircularProgressIndicator(color:Colors.white,strokeWidth:2)):const Icon(Icons.sync)),IconButton(tooltip:'Sign out',onPressed:signOut,icon:const Icon(Icons.logout))]),bottomNavigationBar:NavigationBar(selectedIndex:tab,onDestinationSelected:(v)=>setState(()=>tab=v),destinations:const [NavigationDestination(icon:Icon(Icons.assignment_outlined),label:'Work orders'),NavigationDestination(icon:Icon(Icons.devices_other_outlined),label:'Equipment'),NavigationDestination(icon:Icon(Icons.business_outlined),label:'Company')]),body:SafeArea(child:Column(children:[Container(width:double.infinity,color:online?const Color(0xFFE6F2ED):const Color(0xFFFFF1D8),padding:const EdgeInsets.all(12),child:Text('${online?'ONLINE':'OFFLINE / UNVERIFIED'} · ${drafts.length} unsent · $message',maxLines:4,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:12))),Expanded(child:RefreshIndicator(onRefresh:sync,child:ListView(padding:const EdgeInsets.all(18),children:[
 if(tab==0)...[
  Text('Ready for the next call.',style:Theme.of(context).textTheme.headlineSmall),const SizedBox(height:8),Text('Only authorized, previously synchronized records are available offline. Industry: ${data?['company']?['industry']??'not loaded'}.'),const SizedBox(height:12),
  if(manager)FilledButton.icon(onPressed:online?()=>create('work'):null,icon:const Icon(Icons.add),label:const Text('Create work order')),
  if(rows('work_orders').isEmpty)const Card(child:Padding(padding:EdgeInsets.all(24),child:Text('No cached work orders. Connect and synchronize, or ask your supervisor to assign work.'))),
  for(final w in rows('work_orders'))Card(child:ListTile(onTap:()=>openWork(w),leading:const CircleAvatar(backgroundColor:navy,child:Icon(Icons.build_outlined,color:gold)),title:Text('${w['title']}'),subtitle:Text('${w['customer_name']} · ${w['site_name']}\n${w['manufacturer']} ${w['model']} · ${w['number']}'),isThreeLine:true,trailing:Chip(label:Text('${w['status']}',style:const TextStyle(fontSize:10))))),
 ],
 if(tab==1)...[Text('Equipment inventory',style:Theme.of(context).textTheme.headlineSmall),if(manager)FilledButton.icon(onPressed:online?()=>create('equipment'):null,icon:const Icon(Icons.add),label:const Text('Add equipment')),for(final e in rows('equipment'))Card(child:ListTile(title:Text('${e['manufacturer']} ${e['model']}'),subtitle:Text('Serial: ${e['serial_number']} · ${e['room']}\n${e['category']} · firmware ${e['firmware']}'),onTap:()async{final related=rows('work_orders').where((w)=>w['equipment_id']==e['id']).toList();await showDialog<void>(context:context,builder:(ctx)=>AlertDialog(title:const Text('Cached maintenance history'),content:SizedBox(width:400,child:ListView(shrinkWrap:true,children:[if(related.isEmpty)const Text('No related cached work orders.'),for(final w in related)ListTile(title:Text('${w['title']}'),subtitle:Text('${w['status']} · ${w['updated_at']}'))])),actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Close'))]));})))] ,
 if(tab==2)...[Text('${data?['company']?['name']??'Company workspace'}',style:Theme.of(context).textTheme.headlineSmall),Text('${user['name']} · ${user['role']}'),SwitchListTile(title:const Text('Synchronize when online'),subtitle:const Text('Saved service notes are queued for your company server. No cloud AI or photos are uploaded.'),value:autoSync,onChanged:(v)=>setState(()=>autoSync=v)),const Card(child:Padding(padding:EdgeInsets.all(16),child:Text('Phase 1: factual records and PDF reports. AI diagnosis, manuals, voice, photos, signatures, payment and full web administration are not enabled.'))),if(manager)Wrap(spacing:8,children:[OutlinedButton(onPressed:online?()=>create('customer'):null,child:const Text('Add customer')),OutlinedButton(onPressed:online?()=>create('site'):null,child:const Text('Add site')),if(['owner','administrator'].contains(user['role']))OutlinedButton(onPressed:online?()=>create('engineer'):null,child:const Text('Add engineer'))]),const SizedBox(height:14),const Text('Customers'),for(final c in rows('customers'))Card(child:ListTile(title:Text('${c['name']}'),subtitle:Text('${c['contact']}'))),const SizedBox(height:14),const Text('Sites'),for(final s in rows('sites'))Card(child:ListTile(title:Text('${s['name']}'),subtitle:Text('${s['address']}')))],
 const SizedBox(height:24),const Text('Safety: follow verified manufacturer procedures. Qualified personnel only for hazardous work; never bypass protective systems.',style:TextStyle(fontSize:11,color:Colors.blueGrey)),
 ])))])));
}

class WorkDetail extends StatefulWidget {
 final Map<String,dynamic> work;final FieldApi api;final FieldStore store;final bool online,manager;final List<Map<String,dynamic>> cachedNotes;final Future<void> Function({bool silent}) onSync;
 const WorkDetail({super.key,required this.work,required this.api,required this.store,required this.online,required this.manager,required this.cachedNotes,required this.onSync});
 @override State<WorkDetail> createState()=>_WorkDetailState();
}
class _WorkDetailState extends State<WorkDetail>{
 late Map<String,dynamic> work;late List<Map<String,dynamic>> notes;
 final fields={for(final k in sections.keys)k:TextEditingController()};
 List<Map<String,Object?>> drafts=[];String message='';bool busy=false;
 @override void initState(){super.initState();work={...widget.work};notes=widget.cachedNotes;loadDrafts();}
 Future<void> loadDrafts()async{drafts=(await widget.store.drafts()).where((d)=>d['work_order_id']==work['id']).toList();if(mounted)setState((){});}
 @override void dispose(){for(final c in fields.values)c.dispose();super.dispose();}
 Future<void> save()async{
  if(fields.values.every((c)=>c.text.trim().isEmpty)){setState(()=>message='Record at least one actual observation.');return;}
  setState(()=>busy=true);
  try{final all=await widget.store.drafts();final pending=all.where((d)=>d['work_order_id']==work['id']&&d['state']=='pending').length;
   await widget.store.queueNote(work['id'],{'mutation_id':newMutationId(),'expected_version':(work['version'] as int)+pending,'recorded_at':DateTime.now().toUtc().toIso8601String(),for(final e in fields.entries)e.key:e.value.text.trim()});
   for(final c in fields.values)c.clear();await loadDrafts();if(mounted)setState(()=>message='Saved on this device. It will synchronize when online; missing facts remain unconfirmed.');
  }catch(e){if(mounted)setState(()=>message='$e');}finally{if(mounted)setState(()=>busy=false);}
 }
 Future<void> refresh()async{
  setState(()=>busy=true);
  try{await widget.onSync();work=Map<String,dynamic>.from(await widget.api.json('/work-orders/${work['id']}'));notes=(await widget.api.json('/work-orders/${work['id']}/notes') as List).map((v)=>Map<String,dynamic>.from(v)).toList();await loadDrafts();if(mounted)setState(()=>message='Refreshed. Review conflicts before rebasing.');}catch(e){if(mounted)setState(()=>message='Server unavailable; local drafts kept. $e');}finally{if(mounted)setState(()=>busy=false);}
 }
 Future<void> changeStatus(String target)async{
  setState(()=>busy=true);
  try{final updated=await widget.api.json('/work-orders/${work['id']}',method:'PUT',body:{'expected_version':work['version'],'status':target});work=Map<String,dynamic>.from(updated);await widget.onSync();if(mounted)setState(()=>message='Status updated by your explicit action. Service times are not inferred.');}catch(e){if(mounted)setState(()=>message='$e');}finally{if(mounted)setState(()=>busy=false);}
 }
 Future<void> rebase(Map<String,Object?> draft)async{
  try{final latest=Map<String,dynamic>.from(await widget.api.json('/work-orders/${work['id']}'));final remote=(await widget.api.json('/work-orders/${work['id']}/notes') as List);
   if(!mounted)return;final ok=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(title:const Text('Review server changes before retry'),content:SingleChildScrollView(child:Text('Server revision ${latest['version']} · ${latest['status']}\n\nLatest server notes:\n${remote.map((n)=>sections.entries.map((s)=>'${s.value}: ${n[s.key]}').join('\n')).join('\n\n')}\n\nYour preserved local draft:\n${draft['body']}\n\nRebase only if these are still accurate observations. No server record will be overwritten.')),actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('Keep conflict')),FilledButton(onPressed:latest['status']=='Closed'?null:()=>Navigator.pop(ctx,true),child:const Text('Retain facts & retry as new revision'))]));
   if(ok==true){await widget.store.rebase(draft['id'] as String,latest['version'] as int);work=latest;await loadDrafts();}
  }catch(e){if(mounted)setState(()=>message='$e');}
 }
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text('${work['number']}'),actions:[IconButton(tooltip:'Refresh & sync',onPressed:busy?null:refresh,icon:const Icon(Icons.sync))]),body:ListView(padding:const EdgeInsets.all(20),children:[
 Text('${work['title']}',style:Theme.of(context).textTheme.headlineSmall),const SizedBox(height:10),Text('${work['customer_name']} · ${work['site_name']} · ${work['room']}'),Text('${work['manufacturer']} ${work['model']}\nSerial: ${work['serial_number']}'),Wrap(spacing:8,children:[Chip(label:Text('${work['status']}')),Chip(label:Text('Revision ${work['version']}'))]),
 if(message.isNotEmpty)Padding(padding:const EdgeInsets.symmetric(vertical:12),child:Text(message,style:const TextStyle(color:Colors.blueGrey))),
 if(widget.online)Wrap(spacing:8,children:[for(final s in (transitions[work['status']]??<String>[]).where((s)=>s!='Closed'||widget.manager))OutlinedButton(onPressed:busy?null:()=>changeStatus(s),child:Text(s))]),
 FilledButton.icon(onPressed:!widget.online||busy?null:()async{setState(()=>busy=true);try{final response=await widget.api.send('/work-orders/${work['id']}/report.pdf');await Printing.sharePdf(bytes:response.bodyBytes,filename:'${work['number']}-v${work['version']}.pdf');}catch(e){if(mounted)setState(()=>message='$e');}finally{if(mounted)setState(()=>busy=false);}},icon:const Icon(Icons.picture_as_pdf_outlined),label:const Text('Export server PDF report')),
 const Text('PDF export requires connection in Phase 1. Empty sections are marked “Requires engineer confirmation”. No invented actions, parts or successful outcomes.',style:TextStyle(fontSize:12,color:Colors.blueGrey)),const SizedBox(height:20),
 Text('Record your actual field work',style:Theme.of(context).textTheme.titleLarge),const Text('Saved locally first. Reconnect to synchronize. Do not record a successful outcome unless you actually verified it.'),
 for(final section in sections.entries)Padding(padding:const EdgeInsets.symmetric(vertical:9),child:TextField(controller:fields[section.key],enabled:work['status']!='Closed'&&!busy,maxLines:4,maxLength:8000,decoration:InputDecoration(labelText:section.value,hintText:'Actual observation, or leave empty for confirmation'))),
 FilledButton.icon(onPressed:busy||work['status']=='Closed'?null:save,icon:const Icon(Icons.save_outlined),label:const Text('Save note on device')),
 const SizedBox(height:20),Text('Unsent local records (${drafts.length})',style:Theme.of(context).textTheme.titleMedium),
 for(final d in drafts)Card(child:Padding(padding:const EdgeInsets.all(14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('${d['state']}'.toUpperCase(),style:TextStyle(color:d['state']=='pending'?navy:Colors.deepOrange,fontWeight:FontWeight.bold)),Text('${d['error']}'),Text(sections.entries.map((s)=>'${s.value}: ${jsonDecode(d['body'] as String)[s.key]}').join('\n')),if(d['state']!='pending')TextButton(onPressed:busy?null:()=>rebase(d),child:const Text('Review server version & resolve'))]))),
 const SizedBox(height:20),Text('Synchronized service notes (${notes.length})',style:Theme.of(context).textTheme.titleMedium),for(final n in notes)Card(child:Padding(padding:const EdgeInsets.all(14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('${n['recorded_at']}',style:const TextStyle(fontSize:11,color:Colors.blueGrey)),for(final s in sections.entries)Padding(padding:const EdgeInsets.symmetric(vertical:5),child:Text('${s.value}: ${n[s.key]?.toString().isNotEmpty==true?n[s.key]:'Requires engineer confirmation'}'))]))),
 ]));
}
