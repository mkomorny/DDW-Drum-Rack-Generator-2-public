// DDW Phase 0 spike — proves SimplerDevice.replace_sample works from a v8
// object on Live 12.4.5b11 before any of the real bridge gets built.
// Not part of the shipped device. See m4l/spike/README.md for how to run
// this inside a throwaway Max for Live device.
//
// What it does: finds the Drum Rack on the same track as the hosting M4L
// device, locates the first pad that already has a chain, confirms that
// pad's first device is a Simpler, and calls replace_sample with
// TEST_SAMPLE_PATH. Every step posts to the Max console so a failure is
// visible, not silent.

autowatch = 1;
inlets = 1;
outlets = 1;

// EDIT before running:
var TEST_SAMPLE_PATH = "C:/Users/<you>/Documents/Ableton/Cloud Manager/e47da667-8cb2-47ee-896b-44be3a7073d0/Set 8/Samples/12_07_26-R2-crop4.wav";

// Rather than hardcode a note number (Live's on-screen pad octave labels
// don't reliably map to a single MIDI convention across setups), this scans
// the rack for the first pad that already has a chain and uses that one.

function bang() {
	try {
		runTest();
	} catch (e) {
		post("DDW spike: EXCEPTION " + e.toString() + "\n");
		outlet(0, "fail", "exception");
	}
}

// LiveAPI list-valued properties (e.g. "devices", "drum_pads", "chains")
// come back flattened as ["id", N, "id", N, ...]. Pull out just the ids.
function idListToIds(propArray) {
	var ids = [];
	for (var i = 0; i < propArray.length; i += 2) {
		if (propArray[i] === "id") ids.push(propArray[i + 1]);
	}
	return ids;
}

function runTest() {
	post("DDW spike: starting\n");

	var track = new LiveAPI("this_device canonical_parent");
	if (!track || track.id == 0) {
		post("DDW spike: FAIL - could not resolve host track\n");
		outlet(0, "fail", "no-track");
		return;
	}
	post("DDW spike: track = '" + track.get("name") + "'\n");

	var deviceIds = idListToIds(track.get("devices"));
	var drumRackId = null;
	for (var i = 0; i < deviceIds.length; i++) {
		var dev = new LiveAPI("id " + deviceIds[i]);
		if (dev.get("class_name")[0] === "DrumGroupDevice") {
			drumRackId = deviceIds[i];
			break;
		}
	}
	if (drumRackId === null) {
		post("DDW spike: FAIL - no Drum Rack on this track\n");
		outlet(0, "fail", "no-drum-rack");
		return;
	}
	post("DDW spike: found Drum Rack, id " + drumRackId + "\n");

	var rack = new LiveAPI("id " + drumRackId);
	var padIds = idListToIds(rack.get("drum_pads"));
	var targetPad = null;
	var targetNote = null;
	for (var j = 0; j < padIds.length; j++) {
		var pad = new LiveAPI("id " + padIds[j]);
		var chainIdsCheck = idListToIds(pad.get("chains"));
		if (chainIdsCheck.length > 0) {
			targetPad = pad;
			targetNote = pad.get("note")[0];
			break;
		}
	}
	if (!targetPad) {
		post("DDW spike: FAIL - no populated pad found on this rack (every pad is empty)\n");
		outlet(0, "fail", "no-populated-pad");
		return;
	}
	post("DDW spike: found populated pad, note " + targetNote + "\n");

	var chainIds = idListToIds(targetPad.get("chains"));
	var chain = new LiveAPI("id " + chainIds[0]);
	var chainDeviceIds = idListToIds(chain.get("devices"));
	if (chainDeviceIds.length === 0) {
		post("DDW spike: FAIL - pad's chain has no devices\n");
		outlet(0, "fail", "empty-chain");
		return;
	}
	var simpler = new LiveAPI("id " + chainDeviceIds[0]);
	var className = simpler.get("class_name")[0];
	post("DDW spike: pad's first device class = " + className + "\n");
	if (className !== "OriginalSimpler") {
		post("DDW spike: FAIL - expected OriginalSimpler, got " + className + " (this pad probably uses Drum Sampler)\n");
		outlet(0, "fail", "not-simpler");
		return;
	}

	post("DDW spike: calling replace_sample with " + TEST_SAMPLE_PATH + "\n");
	simpler.call("replace_sample", TEST_SAMPLE_PATH);
	post("DDW spike: replace_sample call sent - check the pad in Live now\n");
	outlet(0, "sent");
}
