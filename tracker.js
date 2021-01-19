const dgram=require('dgram');
const Buffer=require('buffer').Buffer;
const urlParse=require('url').parse;
const crypto=require('crypto');
const utils=require('./utils');
const config=require('./config');


module.exports.getPeers=(torrent,exp_callback)=>{
    const socket=dgram.createSocket('udp4');
    socket.bind(6888,()=>{socket.setRecvBufferSize(15000);});
    
    var announceTimeout;
    const connMsg=buildConnReq();
    const transID=connMsg.slice(12);
    
    var peers=new Array();

    let currAnnounce=2;
    udpSend(socket,connMsg, torrent.announceList[0] ,()=>{console.log('connecting to tracker...')});

    socket.on('message', (response,sender) =>{
        clearTimeout(announceTimeout);
        const senderUrl='udp://'+ sender.address+':'+sender.port;
        if(respType(response)==='connect'){
            const connResp = parseConnResp(response);
            if(Buffer.compare(connResp.transID,transID)!=0){
                console.log('Failed! Trying again...')
                udpSend(socket, buildConnReq(),senderUrl,()=>{console.log('connecting to tracker...')});
            }else{
                console.log('connected!');
            }
            const announceReq = buildAnnounceReq(connResp.connID,torrent);
            udpSend(socket, announceReq,senderUrl,()=>{console.log('announcing to tracker...')});
        }
        else if(respType(response)==='announce'){
            console.log('announce successful!');
            const announceResp = parseAnnounceResp(response);
            exp_callback(announceResp.peers);
        }
        console.log(response);
    })

    function udpSend(socket,message,rawUrl, callback=()=>{}){
        const url = urlParse(rawUrl);
        console.log(message, rawUrl);
        if(url.protocol=='udp:')socket.send(message,0,message.length,url.port,url.hostname,callback);
        currAnnounce++;
        if(torrent.announceList.length>currAnnounce)
            announceTimeout=setTimeout(()=>udpSend(socket,message,torrent.announceList[currAnnounce],callback),config.TRACKERTIMEOUT);
    }

    // socket.on('listening', () => {
    //     const address = socket.address();
    //     console.log(`listening to ${address.address}:${address.port}`);
    //   });
}



//refer to http://www.bittorrent.org/beps/bep_0015.html#connect
function buildConnReq(){
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(0x417, 0);
    buf.writeUInt32BE(0x27101980, 4);
    buf.writeUInt32BE(0,8);
    crypto.randomBytes(4).copy(buf,12);
    return buf;
}
//refer to http://www.bittorrent.org/beps/bep_0015.html#announce
function buildAnnounceReq(connID,torrent,port=config.PORT){
    const buf = Buffer.alloc(98);
    //connection ID 64bit
    connID.copy(buf,0);
    //action 32bit (1=announce)
    buf.writeUInt32BE(1, 8);
    //transaction ID 32bit 
    crypto.randomBytes(4).copy(buf,12);
    //infoHash 20 bytes
    torrent.infoHash.copy(buf,16);
    //peerID 20 bytes
    utils.generateId().copy(buf,36);
    //downloaded 64bits (0 for now)
    buf.writeBigUInt64BE(0n,56);
    //left 64 bits (size for now)
    buf.writeBigUInt64BE(BigInt(torrent.size),64);
    //uploaded 64 bits (0 for now)
    buf.writeBigUInt64BE(0n,72);
    //event 32 bits (0:none)
    buf.writeUInt32BE(0,80);
    //IP address 32bit (0:default)
    buf.writeUInt32BE(0,84);
    //key 32bit
    crypto.randomBytes(4).copy(buf, 88);
    //num_want 32bit (-1:default)
    buf.writeUInt32BE(50,92);
    //port 16bit
    buf.writeUInt16BE(port,96);
    return buf;
}

function respType(resp) {
    const action = resp.readUInt32BE(0);
    if (action === 0) return 'connect';
    if (action === 1) return 'announce';
}

function parseConnResp(resp){
    return{
        action : resp.readUInt32BE(0),
        transID : resp.slice(4,8),
        connID : resp.slice(8)
    }
}

function parseAnnounceResp(resp){
    return{
        action : resp.readUInt32BE(0),
        transID : resp.slice(4,8),
        interval : resp.readUInt32BE(8,12),
        leechers: resp.readUInt32BE(8),
        seeders: resp.readUInt32BE(12),
        peers: utils.group(resp.slice(20), 6).map(address => {
            return {
                ip: address.slice(0, 4).join('.'),
                port: address.readUInt16BE(4)
            }
        })
    }
}