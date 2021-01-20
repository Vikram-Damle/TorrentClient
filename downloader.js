const net = require('net');
const messages = require('./message');
const Bitfield = require('./utils').Bitfield;
const crypto=require('crypto');
const config =require('./config');
const utils = require('./utils');
const cliProgress = require('cli-progress');
const fs= require('fs');

let completePieces=0;
var torrent;
var peers;
var pieces;
var bitfield;
var bfFile;
var blockPerPiece;
var has_initiated=false;

class Peer{
    constructor(ip,port){
        this.ip=ip;
        this.port=port;
        this.socket=null;
        this.isFree=true;
        this.downloading=-1;
        this.downloadingBlock=null;
        this.completedBlocks=0;
        this.pieces=new Array();
        this.isChoking=true;
    }
}

class Piece{
    constructor(index){
        //0:none, 1:requested, 2:completed
        this.index=index;
        this.state=0;
        this.peers=new Array();
        this.progress=null;
    }
}

module.exports.initDownload=(parsedTorrent)=>{
    has_initiated=true;
    torrent=parsedTorrent;
    fd= utils.openOverwrite(config.DOWNLOADPATH);
    pieces=new Array();
    peers = new Array();
    blockPerPiece = torrent.pieceLength/config.BLOCKLENGTH;
    if(fs.existsSync(config.BITFIELDPATH)){
        bitfield= Bitfield.fromBuffer(fs.readFileSync(config.BITFIELDPATH),torrent.pieceCount);
        console.log(bitfield.buffer);
    }else{
        bitfield= new Bitfield(torrent.pieceCount);
        fs.writeFileSync(config.BITFIELDPATH,bitfield.buffer);
        console.log(bitfield.buffer);
        console.log(fs.readFileSync('bitfield.bfd'));
    }
    bfFile=utils.openOverwrite(config.BITFIELDPATH);
    for(i=0;i<torrent.pieceCount;i++){
        pieces.push(new Piece(i));
        if(bitfield.get(i)){
            pieces[i].state=2;
            completePieces++;
        }
    }
    console.log("************************************************** "+completePieces);
    bitfield.print();
}

module.exports.addPeers=(peer_conns)=>{
    if(!has_initiated){
        console.warn("Download has not been initiated. Use initDownload to initiate.");
        return;
    }
    peer_conns.forEach(peer_conn => {
        initiate(peer_conn);
    });
}

function initiate(peer_conn){
    const peer = new Peer(peer_conn.ip,peer_conn.port);
    peers.push(peer);
    const socket = new net.Socket();


    let interestedInterval=false;
    let keepAliveIntv=false;
    
    socket.connect(peer.port,peer.ip,()=>{
        peer.socket=socket;
        console.log(peer.ip+' connected!');
        socket.write(messages.Handshake(torrent));
    });

    onMessage(socket,(data)=>{
        if(!messages.isHandshake(data))
            handleMessage(messages.parse(data));
        else
            handleHandshake(data);
    }) 
    
    socket.on('close',()=>{
        if(interestedInterval)clearInterval(interestedInterval);
        if(keepAliveIntv)clearInterval(keepAliveIntv);
        console.log(peer.ip + " closed the connection...Downloading piece: " + peer.downloading);
        if(peer.downloading!=-1){
            let dp=peer.pieces[peer.downloading];
            dp.state=0;
        }
    });

    socket.on('error',(error)=>{console.log(peer.ip ,"ERROR: " + error)});


    function handleHandshake(data){
        console.log("Recieved Handshake!");
        let msg=messages.parseHandshake(data);
        console.log(msg);
        sendInterested(5000);
        socket.write(messages.Unchoke());
        //socket.write(messages.Bitfield(bitfield.buffer))
        keepAlive(60000);
    }
    
    function sendInterested(interval){
        interestedInterval=setInterval(()=>{
            if(!peer.isChoking){
                clearInterval(interestedInterval);
                interestedInterval=false;
            }
            else{
                socket.write(messages.Interested());
                console.log("sending interested to "+peer.ip);
            } 
        },interval)
    }

    function keepAlive(interval){
        keepAliveIntv=setInterval(()=>{
            socket.write(messages.KeepAlive());
        },interval);
    }
    function handleMessage(msg){
        if(msg.len==0){
            console.log("Received KEEP ALIVE from "+ peer.ip);
        }
        if(msg.id==0){
            console.log("choked by "+peer.ip+" ============================= T-T");
            peer.isChoking=true;
            if(!interestedInterval)sendInterested(5000);
        }
        if(msg.id==1){
            console.log("unchoked by "+peer.ip+" ============================= ^-^");
            peer.isChoking=false;
            console.log(peer.downloading);
            if(peer.downloading==-1){
                for(i=0;i<peer.pieces.length;i++){
                    console.log(peer.pieces[i].index,peer.pieces[i].state);
                    if(peer.pieces[i].state==0){
                        requestPiece(peer.pieces[i]);
                        break;
                    }
                }
            }else requestPiece(peer.pieces[peer.downloading]);
        }
        if(msg.id==2){
            console.log("Received INTERESTED from "+ peer.ip);
            socket.write(messages.Unchoke());
        }
        if(msg.id==4){
            pieces[msg.pieceIndex].peers.push(peer);
            peer.pieces.push(pieces[msg.pieceIndex]);
            if(pieces[msg.pieceIndex].state==0 && peer.isFree && !peer.isChoking){
                requestPiece(pieces[msg.pieceIndex]);
            }
        }
        if(msg.id==5){
            let bf=Bitfield.fromBuffer(msg.bitfield);
            for(i=0;i<torrent.pieceCount;i++){
                if(bf.get(i)){
                    pieces[i].peers.push(peer);
                    peer.pieces.push(pieces[i]);
                    if(peer.isFree && pieces[i].state==0 && !peer.isChoking){
                        requestPiece(pieces[i]);
                    }
                }
            }
        }
        
        if(msg.id==7){
            peer.completedBlocks++;
            console.log(msg.index + ": "+ peer.completedBlocks + '/'  + blockPerPiece +' @ '+msg.begin);
            //pieces[msg.index].progress.update(peer.completedBlocks);
            msg.block.copy(peer.downloadingBlock,msg.begin);
            if(peer.completedBlocks==blockPerPiece){

                console.log('Piece '+msg.index+' completed! from '+peer.ip)
                completePieces++;
                console.log(completePieces + ' Pieces completed!')
                utils.writePiece(fd,peer.downloadingBlock,msg.index*torrent.pieceLength);
                pieces[msg.index].state=2;
                bitfield.set(msg.index);
                bitfield.print();
                peer.isFree=true;
                peer.downloading=-1;
                for(i=0;i<peer.pieces.length;i++){
                    //console.log(peer.pieces[i].state==0,!peer.isChoking,peer.isFree);
                    if(peer.pieces[i].state==0 && !peer.isChoking && peer.isFree){
                        requestPiece(peer.pieces[i]);
                    }
                }
                // for(i=0;i<peers.length;i++){
                //     if(peers[i].socket)peers[i].socket.write(messages.Have(msg.index));
                // }
                fs.writeSync(bfFile,bitfield.buffer,0,bitfield.buffer.length,0);
                let pieceHash=crypto.createHash('sha1').update(peer.downloadingBlock).digest();
                console.log(pieceHash);
                console.log(torrent.pieceHash[msg.index]);
                let complete=true;
                for(i=0;i<torrent.pieceCount;i++){
                    if(pieces[i].state!=2)complete=false;
                }
                if(complete){
                    console.log("=============================File Downloaded=================================");
                    process.exit();
                }

            }else{
                socket.write(messages.Request(msg.index,peer.completedBlocks*config.BLOCKLENGTH,config.BLOCKLENGTH));
            }
        }
    }


    
    function onMessage(socket, callback){
        let buf= Buffer.alloc(0);
        let handshake = true;
    
        //for handshake len = len(pstr) + 49
        //for other messages length is stores in first 4 bytes
        const msgLen=()=>handshake? buf.readUInt8(0) + 49 : buf.readUInt32BE(0) + 4;
    
        socket.on('data', (data)=>{
            buf = Buffer.concat([buf,data])
            while(buf.length>=4 && buf.length>=msgLen()){
                callback(buf.slice(0,msgLen()));
                buf = buf.slice(msgLen());
                //since only the first message will be a handshake
                handshake=false;
            }
        })
    }

    function requestPiece(piece){
        // if(piece.index>1)return;
        // piece.progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        // piece.progress.start(blockPerPiece,0);
        peer.isFree=false;
        piece.state=1;
        let blockSize=config.BLOCKLENGTH;
        if(piece.index!=peer.downloading){
            peer.downloading=piece.index;
            peer.downloadingBlock=Buffer.alloc(torrent.pieceLength);
            peer.completedBlocks=0;
        }
        console.log('requesting piece '+piece.index + ' from ' + peer.ip);
        socket.write(messages.Request(piece.index,peer.completedBlocks,blockSize));
    }

}
