const dgram=require('dgram');
const Buffer=require('buffer').Buffer;
const crypto=require('crypto');
const utils=require('./utils');
const config=require('./config');

/* Get the peer lists from the udp trackers of the torrent */
module.exports.getPeers=(torrent,exp_callback)=>{

    const socket=dgram.createSocket('udp4');
    socket.bind(6888,()=>{socket.setRecvBufferSize(15000);});
    
   
    const connMsg=buildConnReq();
    /*transaction id is used to verify the integrity of the response */
    const transID=connMsg.slice(12);
    
    /*Send connection request to each of the udp tracker in the announce list */
    torrent.announceList.forEach(annUrl => {
        sendUdpReq(connMsg, annUrl, ()=>{utils.log('connecting to tracker '+ annUrl + ' ...')});
    });

    /* Handle the responses from the tracker */
    socket.on('message', (response,sender) =>{

        const senderUrl='udp://'+ sender.address+':'+sender.port;

        if(respType(response)==='connect'){
            const connResp = parseConnResp(response);

            /* check if the transaction id matches */
            if(Buffer.compare(connResp.transID,transID)!=0){
                utils.log('Failed: Transaction ID mismatch');
            }else{
                utils.log('Connected to '+ senderUrl +'!');
            }

            /* Build and send announce request to the tracker; tracker will send peer list as response */
            const announceReq = buildAnnounceReq(connResp.connID,torrent);
            sendUdpReq(announceReq, senderUrl,()=>{utils.log('announcing to '+ senderUrl +'...')});
        }
        else if(respType(response)==='announce'){

            utils.log('announce to ' + senderUrl +' successful!');
            /* parse the response and invoke the callback with peer list */
            const announceResp = parseAnnounceResp(response);
            exp_callback(announceResp.peers);
            
        }
    })

    /* Send udp message */
    function sendUdpReq(message, rawUrl, callback=()=>{}){
        /* parses the url string into an object */
        const url = new URL(rawUrl);
        if(url.protocol=='udp:')socket.send(message, 0, message.length, url.port, url.hostname, callback);
    }
}



/* refer to http://www.bittorrent.org/beps/bep_0015.html#connect */
function buildConnReq(){
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(0x417, 0);
    buf.writeUInt32BE(0x27101980, 4);
    buf.writeUInt32BE(0,8);
    crypto.randomBytes(4).copy(buf,12);
    return buf;
}
/* refer to http://www.bittorrent.org/beps/bep_0015.html#announce */
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
    utils.writeBigUInt64BE(buf,0n,56);
    //left 64 bits (size for now)
    utils.writeBigUInt64BE(buf,BigInt(torrent.size),64);
    //uploaded 64 bits (0 for now)
    utils.writeBigUInt64BE(buf,0n,72);
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

/* Categorize resposne by action */
function respType(resp) {
    const action = resp.readUInt32BE(0);
    if (action === 0) return 'connect';
    if (action === 1) return 'announce';
}

/* refer to http://www.bittorrent.org/beps/bep_0015.html#connect */
function parseConnResp(resp){
    return{
        action : resp.readUInt32BE(0),
        transID : resp.slice(4,8),
        connID : resp.slice(8)
    }
}

/* refer to http://www.bittorrent.org/beps/bep_0015.html#announce */
function parseAnnounceResp(resp){
    let peers = [];
    /* the peer list is a continuous buffer with start offset 20;
    every 6 byte segment represent a peer */
    for (let i = 0; i < resp.slice(20).length ; i += 6) {
        peers.push(resp.slice(20 + i, 20 + i + 6));
    }
    return{
        action : resp.readUInt32BE(0),
        transID : resp.slice(4,8),
        interval : resp.readUInt32BE(8,12),
        leechers: resp.readUInt32BE(8),
        seeders: resp.readUInt32BE(12),
        peers: peers.map(address => {
            return {
                ip: address.slice(0, 4).join('.'),
                port: address.readUInt16BE(4)
            }
        })
    }
}