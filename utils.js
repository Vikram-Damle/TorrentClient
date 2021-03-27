const crypto = require('crypto');
const fs = require('fs');
const config = require('./config');
const chalk = require('chalk')
let id = null;
let ws = null;

/* Generates and holds a random peer id, used in tracker requests */
module.exports.generateId = () => {
    //refer to https://wiki.theory.org/index.php/BitTorrentSpecification#peer_id
    if (!id) {
        id = crypto.randomBytes(20);
        Buffer.from('-TC0094-').copy(id, 0);
    }
    return id;
};

/** Bitfield class. Encapsulates buffer whose bits represent boolean values. */
module.exports.Bitfield = class Bitfield{
    /**
     * @param {Number} size - size of the buffer (number of bits)
     */
    constructor(size){
        this.buffer=Buffer.alloc(Math.ceil(size/8));
        this.length=size;
    }

    /**
     * Checks if the bit is set
     * @param {Number} ind - index of the bit
     * @returns {Boolean} - if the bit is set 
     */
    get(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        return ((x & (1<<(7-j))) != 0);
    }

    /**
     * Sets the bit
     * @param {Number} ind - index of the bit
     */
    set(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        this.buffer[i] = x | (1<<(7-j));
    }

    /**
     * Unsets the bit
     * @param {Number} ind - index of the bit
     */
    unset(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        this.buffer[i] = x & ~(1<<(7-j));
    }

    /**
     * Creats a Bitfield object from the given buffer
     * @param {Buffer} buffer 
     * @param {Number} size - size of the bitfield (number of bits)
     * @returns {Bitfield}
     */
    static fromBuffer(buffer,size=buffer.length*8){
        const bf = new Bitfield(size);
        bf.buffer = buffer.slice(0,Math.ceil(size/8));
        return bf;
    }

    /**
     * Creates a Bitfield from the given array (1-based)
     * @param {Array} array 
     * @param {Number} size - size of the bitfield (number of bits)
     * @returns {Bitfield}
     */
    static fromArray(array, size){
        const bf = new Bitfield(size);
        array.forEach(ele => {
            bf.set(ele-1);
        });
        return bf;
    }

    /** Prints the bitfield set values are printed as their indices and unset values as - */
    print(){
        for(var i=0;i<this.length;i++){
            if(this.get(i))
                process.stdout.write(i + " ");
            else
                process.stdout.write("- ");
        }
        console.log('');
    }

    /**Count the number of set bits in the bitfield */
    count(){
        let ctr=0;
        for(var i=0;i<this.length;i++){
            if(this.get(i))ctr++;
        }
        return ctr;
    }
}

/**
 * Older versions of node do not support Buffer.writeBigUInt64BE for writing 64-bit integers.
 * This function implements the above using Buffer.writeUInt32BE.
 * @param {Buffer} buf 
 * @param {BigInt} val - Value to be written
 * @param {Number} offset - Offset in the buffer
 */
module.exports.writeBigUInt64BE = function writeBigUInt64BE(buf,val,offset=0){
    let p=BigInt(Math.pow(16,8));
    buf.writeUInt32BE(Math.floor(Number(val/p)),offset);
    buf.writeUInt32BE(Number(val%p), offset+4);
}


const exec = require('child_process').exec;
const http = require('http');

/** Launch the browser UI */
module.exports.launchUI = function(){

    
    /* Create a HTTP server to serve the html and css files for the UI, locally @ port 9495 */
    const server = http.createServer((req, resp) => {
        if(req.url === '/') {
            fs.readFile('./ui.html', (err, html) => {
                if(err) {
                    throw err;
                }
                resp.writeHead(200, {"Content-Type": "text/html"});
                resp.write(html);
                resp.end();
            })
        } else if(req.url === '/uiStyles.css') {
            fs.readFile('./uiStyles.css', (err, data) => {
                if(err) {
                    throw err;
                }
                resp.writeHead(200, {"Content-Type": "text/css"});
                resp.write(data);
                resp.end();
            })
        }
    })

    server.listen(config.UI_HTTP_PORT,()=>{
        /* Open the url of the UI in browser*/
        exec(getStartCommand()+' '+'http://localhost:'+config.UI_HTTP_PORT+'/');
    });

    server.on('error',(e)=>{this.handleUILaunchError(e);})

}

/** Opens the folder in explorer. The file/folder at the end of the path is selected in windows.*/
module.exports.openFolder = function(path){
    path = path.replace(/\//g,'\\');
    if(process.platform == 'win32' || process.platform == 'win64'){
        console.log('explorer /select,' + path);
        exec('explorer /select,' + path);
    }else{
        /* Ubuntu default explorer does not support open and select. Just open the parent directory. */
        path = path.split('\\');
        path = path.slice(0,path.length-1).join('\\');
        exec(getStartCommand() + ' ' + path);
    }
}

/** Get the start command for different OS */
function getStartCommand() {
    switch (process.platform) { 
    case 'darwin' : return 'open';
    case 'win32' : return 'start';
    case 'win64' : return 'start';
    default : return 'xdg-open';
    }
}

/** Set the WS connection for the module. Used by the log function. */
module.exports.setWs = function(wsc){ws=wsc;};

/** Log into terminal or browser console. See config.js */
module.exports.log = function log(){
    let log_mode = config.LOG_MODE;
    if(log_mode.includes(0))
        return;
    if(log_mode.includes(1))
        console.log(...arguments);
    if(log_mode.includes(2) && ws){
        let str = '';
        for (let i = 0; i < arguments.length; i++) {
            const ele = arguments[i];
            str += ele + ' ';
        }
        ws.send(JSON.stringify({type:'text',data:str}));
    }
}

/** Handle errors in launching the UI. */
module.exports.handleUILaunchError = function(e){
    console.log(chalk.red('The UI could not be launched.'));
    console.log(e + '');
    if(e.errno === 'EADDRINUSE')
        console.log(chalk.yellow('Is another instance of the client already running?'));
    console.log('\nThe program will exit automatically after 10s.');
    let ctr=0;
    setInterval(()=>{
        if(ctr==10){
            console.log('\nExiting...')
            process.exit();
        } 
        process.stdout.write('.');
        ctr++;
    }, 1000);
}