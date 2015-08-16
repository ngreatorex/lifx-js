/* 
 * Based on code from https://github.com/magicmonkey/lifxjs. See LICENSE.txt.
 */

module.exports = function() {
	var types = {
		uint8: {
			size: 1,
			deserialize: function(b, start) {
				return b.readUInt8(start);
			},
			serialize: function(b, start, p) {
				return b.writeUInt8(p, start);
			}
		},
		uint16: {
			size: 2,
			deserialize: function(b, start) {
				return b.readUInt16LE(start);
			},
			serialize: function(b, start, p) {
				return b.writeUInt16LE(p, start);
			}
		},
		uint32: {
			size: 4,
			deserialize: function(b, start) {
				return b.readUInt32LE(start);
			},
			serialize: function(b, start, p) {
				return b.writeUInt32LE(p, start);
			}
		},
		hexstring64: {
			size: 8,
			deserialize: function(b, start) {
				var size=8;
				return b.slice(start, start+size).toString("hex");
			},
			serialize: function(b, start, p) {
				var size=8;
				return b.write(p, start, size, "hex")
			}
		},
		float32: {
			size: 4,
			deserialize: function(b, start) {
				var size = 4;
				return b.readFloatLE(start);
			},
			serialize: function(b, start, p) {
				return b.writeFloatLE(p, start);
			}
		},
		byte2: {
			size: 2,
			deserialize: function(b, start) {
				var size = 2;
				return b.slice(start, start+size);
			},
			serialize: function(b, start, p) {
				return p.copy(b, start, 0, 2);
			}
		},
		byte4: {
			size: 4,
			deserialize: function(b, start) {
				var size = 4;
				return b.slice(start, start+size);
			},
			serialize: function(b, start, p) {
				return p.copy(b, start, 0, 4);
			}
		},
		byte8: {
			size: 8,
			deserialize: function(b, start) {
				var size = 8;
				return b.slice(start, start+size);
			},
			serialize: function(b, start, p) {
				return p.copy(b, start, 0, 8);
			}
		},
		string32: {
			size: 32,
			deserialize: function(b, start) {
				var size = 32, end = start + size, len;
				for (len = start; len < end; len++) 
					if (b[len] < 32) 
						break;
				return b.slice(start, len).toString();
			},
			serialize: function(b, start, p) {
				var b2 = new Buffer(p);
				return b2.copy(b, start, 0, 32);
			}
		}
	};

	function init() {
		for (var i in deviceMessages) {
			var pkt = deviceMessages[i];
			protocol.messages[pkt.name] = function(pkt) {
				return function(p) {
					if (typeof p != 'object') {
						p = {};
					}
					p.type = pkt.name;
					return protocol.serialize(p);
				}
			}(pkt);
		}
		for (var i in lightMessages) {
			var pkt = lightMessages[i];
			protocol.messages[pkt.name] = function(pkt) {
				return function(p) {
					if (typeof p != 'object') {
						p = {};
					}
					p.type = pkt.name;
					return protocol.serialize(p);
				}
			}(pkt);
		}
	};


	var protocol = {
		source: 0,
		messages: {},
		deserialize: function(b) {
			var newPacket = {header:{}, payload:{}};

			// Deserialize the header
			var runningPlace = 0;
			for (var i=0; i<headerFields.length; i++) {
				var f = headerFields[i];
				newPacket.header[f.name] = f.type.deserialize(b, runningPlace);
				runningPlace += f.type.size;
			}

			// Deserialize the payload
			var pParser = deviceMessages[newPacket.header.type];
			if (typeof pParser == 'undefined') {
				pParser = lightMessages[newPacket.header.type];
			}
			if (typeof pParser == 'undefined') {
				console.log("Unknown packet type "+newPacket.header.type);
			} else {
				newPacket.typeName = pParser.name;
				for (var i=0; i<pParser.fields.length; i++) {
					var f = pParser.fields[i];
					newPacket.payload[f.name] = f.type.deserialize(b, runningPlace);
					runningPlace += f.type.size;
				}
			}

			return newPacket;
		},

		serialize: function(p) {
			if (typeof p.type == 'undefined') {
				console.log("Unknown packet type");
				return;
			}

			var pParser = null;
			for (var i in deviceMessages) {
				if (deviceMessages[i].name == p.type) {
					pParser = deviceMessages[i];
					pParser.type = i;
					break;
				}
			}
			if (pParser == null) {
				for (var i in lightMessages) {
					if (lightMessages[i].name == p.type) {
						pParser = lightMessages[i];
						pParser.type = i;
						break;
					}
				}
			}
			if (pParser == null) {
				console.log("Unknown packet type");
				return;
			}

			var newPacket = new Buffer(36 + pParser.length);
			var newPacketPayload = newPacket.slice(36);

			// Generate payload first as header needs to know length
			var runningPlace = 0;
			for (var i=0; i<pParser.fields.length; i++) {
				if (!(pParser.fields[i].name in p)) {
					console.log("Required field '" + pParser.fields[i].name +"' not specified in payload");
					return;
				}
				pParser.fields[i].type.serialize(newPacketPayload, runningPlace, p[pParser.fields[i].name]);
				runningPlace += pParser.fields[i].type.size;
			}
			
			// Generate header
			var runningPlace = 0;
			for (var i=0; i<headerFields.length; i++) {
				var f = headerFields[i];
				var datum;
				switch (f.name) {
					case 'size':
						datum = 36 + pParser.length;
						break;
					case 'flags1':
						if (typeof p[f.name] == 'undefined') {
							if (pParser.tagged)
								datum = 0x3400;
							else
								datum = 0x1400;
						} else {
							datum = p[f.name];
						}
						break;
					case 'flags2':
						if (typeof p[f.name] == 'undefined') {
							datum = 0x01;
						} else {
							datum = p[f.name];
						}
						break;
					case 'target':
						if (typeof p[f.name] == 'undefined') {
							datum = "000000000000";
						} else {
							datum = p[f.name];
						}
						break;
					case 'source':
						if (typeof p[f.name] == 'undefined') {
							datum = protocol.source;
						} else {
							datum = p[f.name];
						}
						break;
					case 'sequence':
						if (typeof p[f.name] == 'undefined') {
							datum = 0;
						} else {
							datum = p[f.name];
						}
						break;
					case 'reserved1':
					case 'reserved2':
					case 'reserved3':
					case 'reserved4':
						datum = new Buffer(f.type.size);
						datum.fill(0);
						break;
					case 'type':
						datum = pParser.type;
						break;
				}
				f.type.serialize(newPacket, runningPlace, datum);
				runningPlace += f.type.size;
			}
			return newPacket;
		}
	}


	var headerFields = [
		{ name: 'size', 		type: types.uint16 },
		{ name: 'flags1',		type: types.uint16 },
		{ name: 'source',		type: types.uint32 },
		{ name: 'target',		type: types.hexstring64 },
		{ name: 'reserved1',	type: types.byte4 },
		{ name: 'reserved2',	type: types.byte2 },
		{ name: 'flags2',		type: types.uint8 },
		{ name: 'sequence',		type: types.uint8 },
		{ name: 'reserved3',	type: types.byte8 },
		{ name: 'type',			type: types.uint16 },
		{ name: 'reserved4',	type: types.byte2 }
	];

	var deviceMessages = {
		2: {
			name: 'GetService',
			length: 0,
			tagged: 1,
			fields: []
		},
		3: {
			name: 'StateService',
			length: 5,
			flags: {},
			fields: [
				{ name: 'service', 	type: types.uint8  },
				{ name: 'port', 	type: types.uint32 }
			]
		},
		12: {
			name: 'GetHostInfo',
			length: 0,
			flags: {},
			fields: []
		},
		13: {
			name: 'StateHostInfo',
			length: 14,
			flags: {},
			fields: [
				{ name: 'signal',	type: types.float32 },
				{ name: 'tx', 		type: types.uint32  },
				{ name: 'rx',		type: types.uint32  },
				{ name: 'reserved', type: types.uint16  }
			]
		},
		14: {
			name: 'GetHostFirmware',
			length: 0,
			flags: {},
			fields: []
		},
		15: {
			name: 'StateHostFirmware',
			length: 20,
			flags: {},
			fields: [
				{ name: 'build',	type: types.byte8 },
				{ name: 'reserved',	type: types.byte8 },
				{ name: 'version',	type: types.uint32 }
			]
		},
		16: {
			name: 'GetWifiInfo',
			length: 0,
			flags: {},
			fields: []
		},
		17: {
			name: 'StateWifiInfo',
			length: 14,
			flags: {},
			fields: [
				{ name: 'signal',	type: types.float32 },
				{ name: 'tx', 		type: types.uint32  },
				{ name: 'rx',		type: types.uint32  },
				{ name: 'reserved', type: types.uint16  }
			]
		},
		18: {
			name: 'GetWifiFirmware',
			length: 0,
			flags: {},
			fields: []
		},
		19: {
			name: 'StateWifiFirmware',
			length: 20,
			flags: {},
			fields: [
				{ name: 'build',	type: types.byte8 },
				{ name: 'reserved',	type: types.byte8 },
				{ name: 'version',	type: types.uint32 }
			]
		},
		20: {
			name: 'GetPower',
			length: 0,
			flags: {},
			fields: []
		},
		21: {
			name: 'SetPower',
			length: 2,
			flags: {},
			fields: [
				{ name: 'level', type: types.uint16 }
			]
		},
		22: {
			name: 'StatePower',
			length: 2,
			flags: {},
			fields: [
				{ name: 'level', type: types.uint16 }
			]
		},
		23: {
			name: 'GetLabel',
			length: 0,
			flags: {},
			fields: []
		},
		24: {
			name: 'SetLabel',
			length: 32,
			flags: {},
			fields: [
				{ name: 'label', type: types.string32 }
			]
		},
		25: {
			name: 'StateLabel',
			length: 32,
			flags: {},
			fields: [
				{ name: 'label', type: types.string32 }
			]
		},
		32: {
			name: 'GetVersion',
			length: 0,
			flags: {},
			fields: []
		},
		33: {
			name: 'StateVersion',
			length: 12,
			flags: {},
			fields: [
				{ name: 'vendor', 	type: types.uint32 },
				{ name: 'product', 	type: types.uint32 },
				{ name: 'version',	type: types.uint32 }
			]
		},
		34: {
			name: 'GetInfo',
			length: 0,
			flags: {},
			fields: []
		},
		35: {
			name: 'StateInfo',
			length: 24,
			flags: {},
			fields: [
				{ name: 'time', 	type: types.byte8 },
				{ name: 'uptime', 	type: types.byte8 },
				{ name: 'downtime', type: types.byte8 }
			]
		},
		45: {
			name: 'Ack',
			length: 0,
			flags: {},
			fields: []
		},
		58: {
			name: 'EchoRequest',
			length: 8,
			flags: {},
			fields: [
				{ name: 'payload', type: types.byte8 }
			]
		},
		59: {
			name: 'EchoResponse',
			length: 8,
			flags: {},
			fields: [
				{ name: 'payload', type: types.byte8 }
			]
		}
	};

	var lightMessages = {
		101: {
			name: 'Get',
			length: 0,
			flags: {},
			fields: []
		},
		102: {
			name: 'SetColor',
			length: 13,
			flags: {},
			fields: [
				{ name: 'reserved', 	type: types.uint8 },
				{ name: 'hue', 			type: types.uint16 },
				{ name: 'saturation', 	type: types.uint16 },
				{ name: 'brightness', 	type: types.uint16 },
				{ name: 'kelvin', 		type: types.uint16 },
				{ name: 'duration', 	type: types.uint32 }
			]
		},
		107: {
			name: 'State',
			length: 52,
			flags: {},
			fields: [
				{ name: 'hue', 			type: types.uint16 },
				{ name: 'saturation', 	type: types.uint16 },
				{ name: 'brightness', 	type: types.uint16 },
				{ name: 'kelvin', 		type: types.uint16 },
				{ name: 'reserved1', 	type: types.uint16 },
				{ name: 'power', 		type: types.uint16 },
				{ name: 'label', 		type: types.string32 },
				{ name: 'reserved2', 	type: types.byte8 },
			]
		},
		116: {
			name: 'GetPower',
			length: 0,
			flags: {},
			fields: []
		},
		117: {
			name: 'SetPower',
			length: 6,
			flags: {},
			fields: [
				{ name: 'level', 	type: types.uint16 },
				{ name: 'duration',	type: types.uint32 }
			]
		},
		118: {
			name: 'StatePower',
			length: 2,
			flags: {},
			fields: [
				{ name: 'level', 	type: types.uint16 }
			]
		}
	};

	init();

	return protocol;
}();
