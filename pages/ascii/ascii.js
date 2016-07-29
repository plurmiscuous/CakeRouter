/*
	Josh Nazarian
	CSE 154, CF
	
	Homework Assignmnet #7: ASCIImation - Animated ASCII art using JavaScript
	Contents: JavaScript behavior for ascii.html
*/

// module-pattern anonymous function containing JavaScript for ascii.html
(function() {
	"use strict";

	window.addEventListener("load", load);

	let frames;		// array of frames to display in the textarea
	let delay;		// number of milliseconds to wait between switching frames
	let timer;		// identifier for the active timer
	let index;		// which element in frames to display in the textarea

	// sets control settings, event listeners, and initializes value of delay
	function load() {
		controls(false, true);
		document.getElementById("start").addEventListener("click", start);
		document.getElementById("stop").addEventListener("click", stop);
		document.getElementById("animation").addEventListener("change", animation);
		document.getElementById("size").addEventListener("change", size);
		document.getElementById("speed").addEventListener("click", speed);
		// clicking sets delay's intial value without having to explicitly enter it
		document.getElementById("speed").click();
	}

	// sets control settings, captures frame series, and begins animation when 
	// Start button is pressed
	function start() {
		controls(true, false);
		frames = document.getElementById("textarea").value.split("=====\n");
		index = 0;
		document.getElementById("textarea").value = frames[index];
		timer = setInterval(animate, delay);
	}

	// displays individual frames from the series in the textarea when Start
	// button is pressed
	function animate() {
		index = (index + 1) % frames.length;
		document.getElementById("textarea").value = frames[index];
	}

	// sets control settings, stops animation, and restores series of frames
	// when Stop button is pressed
	function stop() {
		controls(false, true);
		clearInterval(timer);
		// returns timer to "intial value"
		timer = undefined;
		document.getElementById("textarea").value = frames.join("=====\n");
	}

	// inserts all frames into the textarea for selected Animation setting
	function animation() {
		document.getElementById("textarea").value = ANIMATIONS[this.value];
	}

	// changes size of font in the textarea to the selected Size setting
	function size() {
		document.getElementById("textarea").className = this.value;
	}

	// changes the frequency at which frames are shown in the textarea when 
	// animation is occurring according to the Speed setting
	function speed() {
		// associative array for increased readability
		let speeds = {"turbo" : 50, "normal" : 250, "slo-mo" : 1500};
		// input[attribute=value]:psuedo-class selector for active radio button
		delay = speeds[document.querySelector("input[name=\"speed\"]:checked").value];
		// timer is undefined only when animation is stopped; stops current
		// frame frequency and restarts at new 
		if(timer !== undefined) {
			clearInterval(timer);
			timer = setInterval(animate, delay);
		}
	}

	// enables and disables controls and textarea depending on the state of the
	// viewer; accepts two booleans where true corresponds to a disabled or
	// read-only control or textarea, respectively
	function controls(controlStartAnimationTextarea, controlStop) {
		document.getElementById("textarea").readOnly = controlStartAnimationTextarea;
		document.getElementById("start").disabled = controlStartAnimationTextarea;
		document.getElementById("animation").disabled = controlStartAnimationTextarea;
		document.getElementById("stop").disabled = controlStop;
	}
})();
