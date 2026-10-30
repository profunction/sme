import {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {apiFor} from './api';
import {Assistant} from './Assistant';
import {Business} from './Business';
import {Settings} from './Settings';
import './style.css';
function App(){
 const [token,setToken]=useState(''),[tab,setTab]=useState('Assistant');
 const api=useMemo(()=>apiFor(token),[token]);
 return <main><aside><h2>☕ NightBrew</h2><p>AI EMPLOYEE</p><h3>Workspace</h3>{['Assistant','Business tools','AI & privacy'].map(name=><button key={name} className={tab===name?'':'secondary'} onClick={()=>setTab(name)}>{name}</button>)}<small>Windows application · Cloud development</small></aside><section><header><span>YOUR DIGITAL WORKFORCE</span><h1>{tab==='Assistant'?'A little help. A lot more possibility.':tab}</h1></header><label>Backend session token<input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off"/></label>{!token?<p>Enter the token from your backend session to access your workspace.</p>:tab==='Assistant'?<Assistant key={token} api={api}/>:tab==='Business tools'?<Business key={token} api={api} token={token}/>:<Settings key={token} api={api}/>}</section></main>
}createRoot(document.getElementById('root')!).render(<App/>);
