// CSE 154, ASCIImation
// Javascript code for ASCIImation voting gallery
//
// Once this file is linked to your page, you should see:
//
// - A list of all ASCIImations in the top-left corner.  Choose a file
//   to have its contents placed into the textarea of your program.
//
// - A "Vote" button at the top left.  This will take you to a UW Catalyst
//   survey where you can vote for which ASCIImations you like the best!
//   (might be disabled, depending on the quarter)
//
// This script will enable itself if you put a ?gallery=true query parameter in
// your page's URL.
//
// This script is a best effort and may not work with everyone's ascii.html
// program.  Contact Marty if it doesn't work for you.

(function() {
	let VOTING = false;
	let SUBMITTING = true;
	let DISABLE_GALLERY = true;
	let FONT = "9pt";

	// link to Facebook app voting page
	let SURVEY_LINK = "http://apps.facebook.com/uwcseapptest/asciimation/vote.php?quarter=49fdf851b1992&homework=49fe37132c93f";

	// link to list of students who have submitted ASCII art before
	let STUDENTS_LIST_LINK = "https://webster.cs.washington.edu/cse154/homework/hw7/ascii.php";

	let textarea = null;
	let uwnetid = "";

	let loadScript = function(url, immediately) {
		if (immediately) {
			document.write("<script src=\"" + url + "\" type=\"text/javascript\"></script>\n");
		} else {
			let scriptTag = document.createElement("script");
			scriptTag.type="text/javascript";
			scriptTag.src = url;
			document.body.appendChild(scriptTag);
		}
	};

	// turn on gallery if student passes a ?gallery=1 query parameter
	parseQueryParams();
	if ($_REQUEST["gallery"] === "1" || $_REQUEST["gallery"] === "true" || location.href.match(/taResources/)) {
		DISABLE_GALLERY = false;
	}

	// attach window onload listener (without disturbing student's)
	if (window.addEventListener) {
		window.addEventListener("load", galleryOnload, false);
	} else if (window.attachEvent) {
		window.attachEvent("onload", galleryOnload);  // IE
	}

	// runs when window loads; puts all student animations into a select box
	function galleryOnload() {
		// add a "heart" icon to tell the student that the file was loaded properly
		let heart = document.createElement("span");
		heart.id = "galleryheart";
		heart.innerHTML = "&hearts;";
		heart.style.color = "red";
		heart.style.backgroundColor = "transparent";
		heart.style.fontFamily = "Arial, sans-serif";
		heart.style.fontSize = "24pt";
		heart.style.lineHeight = "24pt";
		heart.style.position = "fixed";
		heart.style.top = "0px";
		heart.style.left = "0px";
		document.body.appendChild(heart);

		// can't do gallery unless on Webster (XSS security)
		if (DISABLE_GALLERY ||
				(location.hostname != "webster.cs.washington.edu" && !location.href.match(/taResources/))) {
			return;
		}

		// figure out current student ID
		// "/stepp/hw6/ascii.html" -> "stepp"
		uwnetid = location.pathname.substring(1).replace(/students\/([a-zA-Z0-9]+)\/.*/, "$1");
		if (typeof(uwnetid.trim) === "function") {
			uwnetid = uwnetid.trim();
		}
		if (!uwnetid || uwnetid.length < 2 || uwnetid.length > 8) {
			// uwnetid = prompt("Your UW NetID? ");
			SUBMITTING = false;
		}

		// grab global letiable for textarea
		let textareas = document.getElementsByTagName("textarea");
		if (textareas.length == 0) {
			return;
		}
		textarea = textareas[0];

		// try to insert the vote div before the other fieldsets on the page, if any
		let firstFieldset = document.getElementsByTagName("fieldset")[0];
		if (firstFieldset) {
			voteDiv = document.createElement("fieldset");
			voteDiv.id = "votes";
			let legend = document.createElement("legend");
			legend.innerHTML = "Gallery:";
			voteDiv.appendChild(legend);
			firstFieldset.parentNode.insertBefore(voteDiv, firstFieldset);
			firstFieldset.parentNode.insertBefore(document.createTextNode(" "), firstFieldset);
		} else {
			// fall back to inserting at bottom-left of page
			voteDiv = document.createElement("div");
			voteDiv.id = "votes";
			voteDiv.style.fontSize = FONT;
			voteDiv.style.fontWeight = "normal";
			voteDiv.style.left = "0px";
			voteDiv.style.position = "fixed";
			voteDiv.style.bottom = "0px";
			voteDiv.style.fontSize = FONT;
			voteDiv.style.fontWeight = "normal";
			document.body.appendChild(voteDiv);
		}

		if (VOTING) {
			// set up "vote" link
			let a = document.createElement("a");
			a.href = SURVEY_LINK;
			a.innerHTML = "Vote!";
			a.target = "_blank";   // open in new window
			voteDiv.appendChild(a);
		}

		if (SUBMITTING) {
			// set up "submit" button
			let button = document.createElement("button");
			button.id = "submitasciiart";
			button.innerHTML = "Submit";
			button.title = "Click here to submit your ASCII art to Webster for other students to see!";
			button.onclick = submitClick;
			if (!firstFieldset) {
				button.style.fontSize = FONT;
				button.style.fontWeight = "normal";
			}
			voteDiv.appendChild(button);
		}

		// put initial empty select box onto the page
		let select = document.createElement("select");
		select.id = "gallery";
		select.onchange = loadAnimation;
		select.title = "This is a list of other students' ASCII art that has been submitted to Webster.  Take a look!";
		if (!firstFieldset) {
			select.style.fontSize = FONT;
			select.style.fontWeight = "normal";
			select.style.width = "90px";
			select.style.maxWidth = "90px";
		}
		voteDiv.appendChild(select);

		let option = document.createElement("option");
		option.value = "";
		option.innerHTML = "Loading...";
		if (!firstFieldset) {
			option.style.fontSize = FONT;
			option.style.fontWeight = "normal";
		}
		select.appendChild(option);

		fetchStudents();
	}

	// Treats the given text as a sequence of lines to be turned into a set of
	// <option> tags to put inside the bottom-left select box.
	function buildSelectOptions(ajax) {
		let text = ajax.responseText;
		if (typeof(text.trim) === "function") {
			text = text.trim();
		}

		// sort by uwnetid
		let sortedStudents = text.split(/\r?\n/);
		sortedStudents.sort();

		// if (sortedStudents.length > 0) {
			// clear out existing students
			let select = document.getElementById("gallery");
			while (select.firstChild) {
				select.removeChild(select.firstChild);
			}
			// initial empty option
			let option = document.createElement("option");
			option.value = "";
			option.innerHTML = "(choose)";
			option.style.fontSize = FONT;
			option.style.fontWeight = "normal";
			select.appendChild(option);

			// turn each student into an option in the select box on bottom left
			for (let i = 0; i < sortedStudents.length; i++) {
				if (sortedStudents[i]) {
					let option = document.createElement("option");
					option.value = option.innerHTML = sortedStudents[i];
					select.appendChild(option);
				}
			}
		// }
	}

	// grabs the entire list of students' UW NetIDs and puts it into the select box.
	function fetchStudents() {
		ajaxHelper(STUDENTS_LIST_LINK, buildSelectOptions);
	}

	// Called when user chooses one of the options in the select box.
	// Fetches that student's ASCII art using Ajax and puts it in the textarea.
	function loadAnimation() {
		let uwnetid = this.value;
		if (!uwnetid) {
			return;
		}
		textarea.value = "Fetching from Webster server...";

		// grab this student's ASCII art using Ajax and put into textarea
		ajaxHelper(STUDENTS_LIST_LINK +
				(STUDENTS_LIST_LINK.match(/[?]/) ? "&" : "?") +
				"name=" + uwnetid,
			function(ajax) {
				textarea.value = ajax.responseText;
			}
		);
	}

	// Called when the 'Submit' button is clicked.
	// Asks the user whether to submit his/her ASCII animation to the server,
	// and if so, sends its data using Ajax to the Webster server to be saved.
	function submitClick(event) {
		if (typeof(event.stopPropagation) === "function") {
			event.stopPropagation();
		}

		// abort if could not detect student's UW NetID or if textarea is empty
		if (!uwnetid || !textarea.value) {
			return;
		}

		// Ask the user whether to submit his/her ASCII animation to the server
		if (!confirm("This will submit an ASCII animation for '" + uwnetid + "' to our gallery for other students to see.  The ASCII art submitted will be whatever is currently showing in your main text area.  Continue?")) {
			return;
		}

		// submit this student's ASCII art using Ajax to the Webster server
		ajaxHelper(STUDENTS_LIST_LINK,
			function(ajax) {
				alert("Your ASCII art was submitted successfully!");
				fetchStudents();
			},
			true,
			{"name": uwnetid, "ascii": textarea.value}
		);

		return false;
	}

	function ajaxHelper(url, fn, post, params) {
		let ajax = new XMLHttpRequest();
		let paramStr = null;

		// Call the function fn if the request completes successfully,
		// or show an error message if the request failed
		ajax.onreadystatechange = function(event) {
			if (ajax.readyState == 4) {
				if (ajax.status == 200) {
					fn(ajax);
				} else if (ajax.status != 0) {
					ajaxError(ajax);
				}
			}
		};

		// append a unique junk parameter at the end to stop browser from caching
		if (post) {
			// POST; put in params hash then turn into a string
			paramStr = "";
			if (params) {
				params["dontcacheme"] = new Date().getTime() + "+" + Math.random();
				for (let name in params) {
					paramStr += (paramStr.length == 0 ? "" : "&") + encodeURIComponent(name) + "=" + encodeURIComponent(params[name]);
				}
			}
		} else {
			// POST; put on URL
			url += (url.match(/[?]/) ? "&" : "?") + "dontcacheme=" + (new Date().getTime() + "+" + Math.random());
		}

		// begin the request
		ajax.open(post ? "POST" : "GET", url, true);

		if (post) {
			ajax.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
			// ajax.setRequestHeader("Content-length", paramStr.length);
		}
		ajax.send(paramStr);
	}

	// Fetches data using Ajax and calls the given function when it arrives.
	function ajaxError(ajax, exception) {
		let errorText = "Error making web request.\n\nServer status:\n" +
			  ajax.status + " " + ajax.statusText + "\n\n" +
			  "Server response text:\n" + ajax.responseText;
		if (exception) {
			errorText += "\nException: " + exception.message;
		}
		alert(errorText);
		return errorText;
	}

	// Returns the page's query string as a hash.
	// Also sets it up as a global hash named $_REQUEST.
	// $_REQUEST["name"] -> value of 'name' query param
	function parseQueryParams() {
		$_REQUEST = {};  // PHP-like global array of [paramname -> value]
		if (!window.location.search || window.location.search.length < 1) {
			return $_REQUEST;
		}

		let url = window.location.search.substring(1);
		let chunks = url.split(/&/);
		for (let i = 0; i < chunks.length; i++) {
			let keyValue = chunks[i].split(/=/);
			if (keyValue[0] && keyValue[1]) {
				let thisValue = unescape(keyValue[1]);
				thisValue = thisValue.replace(/[+]/, " ");  // unescape URL spaces
				$_REQUEST[keyValue[0]] = thisValue;
			}
		}
		return $_REQUEST;
	}
})();

