const net = require('net');
const crypto = require('crypto');

var HOST = 'media';
var PORT = 9982;



const HMF_MAP = 1;
const HMF_S64 = 2;
const HMF_STR = 3;
const HMF_BIN = 4;
const HMF_LIST = 5;



//JS Doesn't provide chr/ord.. wrapper functions for readaibility/consistency with the python example
function chr(i) {
	return String.fromCharCode(i);
}

function ord(c) {
  c = '' + c;
  return c.charCodeAt(0);
}

class hmf_bin {}

class HTSPMessage {

	hmf_type(f) {
		if (Array.isArray(f)) return HMF_MAP;
		else if (f instanceof hmf_bin)	return HMF_BIN;
		else if (typeof f == 'object') return  HMF_LIST;
		else if (typeof f == 'string') return HMF_STR;
		else if (typeof f == 'number') return HMF_S64;
	}


	_binary_count(f) {
		var ret = 0;

		if  (typeof f ==  'string' || f instanceof hmf_bin || f instanceof Buffer) {
			ret += f.length;
		}
		else if (typeof(f) == 'number') {
			while (f) {
				ret += 1;
				f = f >> 8;
			}
		}
		else if (typeof(f) == 'object' || Array.isArray(f)) {
			ret += this.binary_count(f);
		}
		else throw new Error('invalid data type');

		return ret;
	}

	binary_count(msg) {
		var ret = 0;

		var list = Array.isArray(msg)

		for (var f in msg) {
			ret += 6;

			if (!list) {
				//for objects add on the length of the key
				ret += f.length;
				//Python treats for ... in differently for objects and lists. for..in works like JS for..of for lists
				//but the same for objects! So for js ignore this line
				//f  = msg[f]
			}

			ret += this._binary_count(msg[f]);
		}

		return ret;
	}

	int2bin(i) {
		return chr(i >> 24 & 0xFF) + chr(i >> 16 & 0xFF) + chr(i >> 8 & 0xFF) + chr(i & 0xFF);
	}

	bin2int(d) {
		 return (ord(d[0]) << 24) + (ord(d[1]) << 16)+ (ord(d[2]) <<  8) + ord(d[3]);
	}

	binary_write(msg) {
		var ret = '';

		var list = Array.isArray(msg);

		for (var f in msg) {
			var na = '';

			if (!list) {
				na = f;
				//Python treats for ... in differently for objects and lists. for..in works like JS for..of for lists
				//but the same for objects! ignore this line
				//f  = msg[f]
			}
			//set f to value rather than key
			f = msg[f];
			ret += chr(this.hmf_type(f));
			ret += chr(na.length & 0xFF);
			var l = this._binary_count(f);

			ret += this.int2bin(l);

			ret += na;

			if (f instanceof Buffer) {
				ret += f;
			}
			else if (f instanceof hmf_bin || typeof f == 'string') ret += f;
			else if (typeof(f) == 'object' || Array.isArray(f)) ret += this.binary_write(f);
			else if (typeof(f) == 'number') {
				while (f) {
					ret += chr(f & 0xFF);
					f = f >> 8;
				}
			}
			else throw new Error('invalid type');
		}

		return ret;
	}


	serialize(msg) {
		var cnt = this.binary_count(msg);
		return Buffer.from(this.int2bin(cnt) + this.binary_write(msg), 'binary');
	}


    deserialize0(data, type = HMF_MAP) {

		var isList = false;
		var msg = {};

		if (type == HMF_LIST) {
			isList = true;
			msg = [];
		}


		while (data.length > 5) {
			//data type

			var typ = ord(data[0]);

			//length of the name
			var nlen = ord(data[1]);

			//length of the data for name/key in nlen
			var dlen = this.bin2int(data.slice(2,6));

			data = data.slice(6);

			var name = data.slice(0, nlen);
			data = data.slice(nlen);


			var item = null;

			if (typ == HMF_STR) {
				item = data.slice(0, dlen).toString();
			}
			else if (typ == HMF_BIN) {
				//not sure why there's a dummy wrapper for this in the python example.. 
			//	item = new Buffer(data.slice(0, dlen), 'binary');
				item = data.slice(0, dlen);
			}
			else if (typ == HMF_S64) {
				item = 0;

				var i = dlen-1;

				while (i >= 0) {
					item = (item << 8) | ord(data[i]);
					i = i -1;
				}
			}
			else if (typ == HMF_LIST || type == HMF_MAP) {
				item = this.deserialize0(data.slice(0, dlen), typ);
			}


			if (isList) msg.push(item);
			else msg[name] = item;

			data = data.slice(dlen);
		}

		return msg;

	}

}

class HTSPClient {
	constructor(host, port, onConnect) {

		this.sock = new net.Socket();
		this.sock.setEncoding('binary');

		var self = this;
		this.sock.connect(port, host, function() {
			onConnect(self);
		});

		this.onData = function(x) {
      console.log('this.onData: ' + x);
		};

		this.sock.on('data', function(data) {
		  //console.log(data);
			self.onData(data);
		});

		this.sock.on('error', function(err) {
			console.log('ERRROR!!!');
			console.log(err);
		});

		this.sock.on('close', function(had_error) {
			console.log('closed - error = '+had_error)
		});

		this.sock.on('end', function() {
			console.log('sock end');
		})

	}

	send(func, args, callback, debug) {
		if (!args) args = {};
		args['method'] = func;

		if (debug) {
			console.log(args);
		}

		var s = new HTSPMessage().serialize(args);

		this.sock.write(s, 'binary', callback);
	}

	hello(callback) {
		var args = {
      		'htspversion' : 23,
      		'clientname'  : 'node-htsp'
    	}

    	var self = this;
    	this.onData = function(data) {
    		self.recvHello(data, callback);
    	};

    	this.send('hello', args);
  }
  
  getDiskSpace(callback) {
		var args = {}

    var self = this;
    this.onData = function(data) {
      self.recvGetDiskSpace(data, callback);
    };

    this.send('getDiskSpace', args);
  }


	recvGetDiskSpace(data, callback) {
		//The data comes back with 3 NULL chars and an odd symbol no idea why, need to remove them for this to work
		//It seems to be a byte order mark but doesn't match utf-8, utf-16 etc.
		//Is this added by the buffer? By the socket? Sent by the server? Could do with a proper explanation,
		//but for now just remove the BOM and continue 
		data = data.slice(4);
		var msg = new HTSPMessage().deserialize0(data);
    callback(msg);
//
  }


	recvHello(data, callback) {
		//The data comes back with 3 NULL chars and an odd symbol no idea why, need to remove them for this to work
		//It seems to be a byte order mark but doesn't match utf-8, utf-16 etc.
		//Is this added by the buffer? By the socket? Sent by the server? Could do with a proper explanation,
		//but for now just remove the BOM and continue 
		data = data.slice(4);
		var msg = new HTSPMessage().deserialize0(data);
    callback(msg);
//
  }
  
  end() {
    this.sock.end();
  }

}

new HTSPClient('127.0.0.1', 9982, (client) => {
  client.getDiskSpace((x) => {
    console.log(x);
    //client.sock.end();

    client.end();
  });
});
