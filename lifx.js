var protocol = require('./protocol');
var dgram    = require('dgram');
var util     = require('util');
var events   = require("events");
var crypto   = require('crypto');

var port = 56700;

function LiFX() {
	events.EventEmitter.call(this);
	var self = this;
	this.bulbs = {};
	this.debug = 0;

	crypto.randomBytes(32, function(ex, buf) {
	 	protocol.source = buf.readUInt32LE(0);
		self._setupListeners();
		self._setupNetwork();
	});
}
util.inherits(LiFX, events.EventEmitter);

LiFX.prototype._setupNetwork = function() {
	this.udpClient = dgram.createSocket("udp4");

	var self = this;
	this.udpClient.on("error", function (err) {
		if (self.debug >= 1) console.error("*** UDP error " + err);
		self.emit('error', err);
	});
	this.udpClient.on("message", function (msg, rinfo) {
		if (self.debug >= 2) console.log("UDP IN " + msg.toString("hex"));
		var pkt = protocol.deserialize(msg);
		if (self.debug >= 2) console.log("  Src IP:", rinfo.address, ", Src Port:", rinfo.port);
		if (self.debug >= 2) console.log("  Type:", pkt.typeName, pkt.type, ", Source:", pkt.header.source);
		if (self.debug >= 2) console.log("  Target:", pkt.header.target);
		if (self.debug >= 2) console.log("  Payload:", pkt.payload);
		if (self.debug >= 2) console.log("---");

		self.emit('packet', pkt, rinfo);
	});
	this.udpClient.bind(port, "0.0.0.0", function() {
		self.udpClient.setBroadcast(true);
		self.emit('ready');
	});
};

LiFX.prototype._getOrCreateBulb = function(pkt, rinfo) {
	var bulb;

	if (!(pkt.header.target in this.bulbs)) {
		bulb = {
			ip: rinfo.address,
			port: rinfo.port,
			target: pkt.header.target,
			pollingInterval: null,
			state: {}
		};
		this.bulbs[pkt.header.target] = bulb;
		this.emit('bulbfound', bulb);
	} else {
		bulb = this.bulbs[pkt.header.target];
	}

	return bulb;
};

LiFX.prototype._setupListeners = function() {
	var self = this;

	this.on('packet', function(pkt, rinfo) {
        var bulb, found = false, i;

        if (self.debug >= 1)
			console.log('Received packet of type ' + pkt.packetTypeName + ' (' + pkt.header.type + ')');

        switch (pkt.packetTypeName) {
        	case 'StateService':
        		var bulb = self._getOrCreateBulb(pkt, rinfo);
        		break;
        	case 'State':
        		var bulb = self._getOrCreateBulb(pkt, rinfo);
        		var changed = false;

        		for (var key in pkt.payload) {
        			if (!key.match(/^reserved/)) {
        				if (bulb.state[key] !== pkt.payload[key]) {
        					bulb.state[key] = pkt.payload[key];
        					changed = true;
        				}
        			}
        		}

        		if (changed)
        			self.emit('bulbupdate', bulb);
        		break;
    		case 'StatePower':
    			var bulb = self._getOrCreateBulb(pkt, rinfo);

    			if (pkt.payload.level != bulb.state.power) {
    				bulb.state.power = pkt.payload.level;
    				self.emit('bulbupdate', bulb);
    			}
    			break;
        	default:
        		if (self.debug >= 1)
        			console.log('Unhandled packet of type ' + pkt.packetTypeName);
        		break;
        }
    });

    this.on('bulbfound', function(bulb) {
    	if (self.debug >= 1) console.log('Found bulb:', bulb);
    	var getMessage = protocol.messages.Get({'target': bulb.target});
    	self.sendMessage(bulb.ip, bulb.port, getMessage);
    	self.stopDiscovery();
    	self.startDiscovery(30000);
    	bulb._pollingInterval = setInterval(function() {
    		self.sendMessage(bulb.ip, bulb.port, getMessage);
    	}, 1000);
    });

    if (self.debug >= 1) {
	    this.on('bulbupdate', function(bulb) {
	    	console.log("Bulb status update: ", bulb.state);
	    });
	}
};

LiFX.prototype.sendMessage = function(dstIp, dstPort, packet) {
	var pkt;
	if (this.debug >= 2) {
		try {
			console.log("UDP OUT " + packet.toString("hex"));
			pkt = protocol.deserialize(packet);
			console.log("  Dst IP:", dstIp, ", Dst Port:", dstPort);
			console.log("  Type:", pkt.packetTypeName, ", Source:", pkt.header.source);
			console.log("  Target:", pkt.header.target);
			console.log("  Payload:", pkt.payload);
		} catch(err) {
			// Ignore
		} finally {
			console.log("---");
		}
	}
	try {
		this.udpClient.send(packet, 0, packet.length, dstPort, dstIp);
	} catch(err) {
		if (this.debug >= 1) console.error(" *** UDP send error " + err);
		this.emit('error', err);
	}
};

LiFX.prototype.startDiscovery = function(interval) {
	var self = this;
	if (this.debug >= 1)
		console.log('Scheduling discovery with interval', interval);

	var message = protocol.messages.GetService();
	this.discoveryIntervalId = setInterval(function() {
		self.sendMessage("255.255.255.255", port, message);
	}, interval);
};

LiFX.prototype.stopDiscovery = function() {
	if (this.debug >= 1)
		console.log('Stopping discovery');

	clearInterval(this.discoveryIntervalId);
};

LiFX.prototype.stop = function() {
	if (this.debug >= 1)
		console.log('Stopping LiFX listener');

	this.stopDiscovery();

	for (var bulbId in this.bulbs) {
		var bulb = this.bulbs[bulbId];
		if (bulb._pollingInterval) {
			if (this.debug >= 2) console.log('Clearing interval for bulb', bulb.target);
			clearInterval(bulb._pollingInterval);
		}
	}

	this.udpClient.close();
};

module.exports = LiFX;

