import {validState,type Musician} from './engine';
export class Mesh {
 id=crypto.randomUUID();socket:WebSocket;peers=new Map<string,RTCPeerConnection>();channels=new Map<string,RTCDataChannel>();isolated=false;
 constructor(url:string,room:string,private receive:(m:Musician)=>void,private status:(s:string)=>void){
 this.socket=new WebSocket(url);
 this.socket.onopen=()=>{this.send({type:'join',room,id:this.id});status('Signalling connected')};
 this.socket.onclose=()=>status('Signalling offline · established peers continue');this.socket.onerror=()=>status('Cannot reach signalling server');
 this.socket.onmessage=async e=>{try{const m=JSON.parse(e.data);if(m.type==='peers'){for(const id of m.peers)await this.connect(id,true)}else if(m.type==='signal'){
 const pc=this.peers.get(m.from)??await this.connect(m.from,false);if(m.description){await pc.setRemoteDescription(m.description);if(m.description.type==='offer'){await pc.setLocalDescription();this.send({type:'signal',to:m.from,description:pc.localDescription})}}else if(m.candidate){await pc.addIceCandidate(m.candidate)}}}catch{status('Peer negotiation failed; rejoin to retry')}};
 }
 send(value:unknown){if(this.socket.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(value))}
 async connect(id:string,offer:boolean){const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});this.peers.set(id,pc);
 pc.onicecandidate=e=>{if(e.candidate)this.send({type:'signal',to:id,candidate:e.candidate})};
 const attach=(ch:RTCDataChannel)=>{this.channels.set(id,ch);ch.onopen=()=>this.status(`${this.channels.size} peer connection(s)`);ch.onmessage=e=>{if(this.isolated)return;try{const m=JSON.parse(e.data);if(validState(m)&&m.id===id)this.receive(m)}catch{/* Ignore malformed peer messages. */}};ch.onclose=()=>{this.channels.delete(id);this.status(`${this.channels.size} peer connection(s)`)}};
 pc.ondatachannel=e=>attach(e.channel);if(offer){attach(pc.createDataChannel('intentions'));await pc.setLocalDescription();this.send({type:'signal',to:id,description:pc.localDescription})}return pc;
 }
 broadcast(m:Musician){if(!this.isolated)for(const ch of this.channels.values())if(ch.readyState==='open'&&ch.bufferedAmount<65536)ch.send(JSON.stringify({...m,id:this.id}))}
 close(){this.socket.onclose=null;for(const ch of this.channels.values())ch.onclose=null;this.socket.close();for(const p of this.peers.values())p.close();this.peers.clear();this.channels.clear()}
}
