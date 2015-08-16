var LiFX = require('./lifx');
var protocol = require('./protocol');

var l = new LiFX();
l.debug = 1;
l.startDiscovery(1000);
l.on('bulbupdate', function(bulb) {
	if (bulb.state.power != 0) {
		console.log("Turning off bulb ", bulb.target);
		l.sendMessage(bulb.ip, bulb.port, protocol.SetPower({level: 0, duration: 1000, target: bulb.target}));
	}
});

setTimeout(function() {
    l.stop();
}, 10000);

//console.log("SetPower: ", protocol.SetPower({level: 65535}));
