/*
	Josh Nazarian
	CSE 154, CF

	Homework Assignmnet #8: Fifteen Puzzle - sliding puzzle game
	Contents: JavaScript behavior for fifteen.html
	Extra Features: #1 and #6
*/

"use strict";

(function() {
	let size;					// number of rows and columns on the board
	let px;						// height and width of each tile in pixels
	let blankRow;				// zero-based row index of the blank tile
	let blankCol;				// zero-based column index of the blank tile
	let id;						// id for setInterval and flag for shuffling

	window.addEventListener("load", load);

	// on page load, creates game tiles and size drop-down menu and sets event
	// listeners for tiles, shuffle button, and size menu
	function load() {
		// initialize letiables to default values
		size = 4;
		px = 400 / size;
		id = 0;
		// set-up the board
		createControls();
		createTiles();
		setTileEventListeners();
		document.getElementById("shufflebutton").addEventListener("click", shuffle);
		document.getElementById("sizemenu").addEventListener("change", resize);
	}

	// inserts a select element below #puzzlearea for changing the size of the
	// board to a size by size board
	function createControls() {
		let text = document.createTextNode("Select a board size: ");
		let dropdown = document.createElement("select");
		dropdown.id = "sizemenu";
		// creates several size options and adds them to #sizemenu
		for(let i = 3; i <= 12; i++) {
		    let option = document.createElement("option");
		    option.value = i;
		    option.innerHTML = i + "x" + i;
		    // 4x4 should be selected by default
		    if(i == 4) {
		        option.setAttribute("selected", "selected");
		    }
		    dropdown.appendChild(option);
		}
		// insert #sizemenu and text before #shufflebutton
		let shuffle = document.getElementById("shufflebutton");
		document.getElementById("controls").insertBefore(text, shuffle);
		document.getElementById("controls").insertBefore(dropdown, shuffle);
	}

	// places (size * size - 1) tiles onto the board
	function createTiles() {
		for(let i = 0; i < size; i++) {
			for(let j = 0; j < size; j++) {
				if(i == size - 1 && j == size - 1) {
					// sets the inital values for blank square's row and columm
					blankRow = i;
					blankCol = j;
				} else {
					// not the blank square; create a new tile
					createTile(i, j);
				}
			}
		}
	}

	// places a single tile onto the board and places the background image at
	// the correct location behind the tile; each tile has class .tile, a
	// unique #id that corresponds to its location on the board, and text to
	// number its location in a "solved" state
	function createTile(i, j) {
		let tile = document.createElement("div");
		// ids represent the location on the board
		tile.id = ("tile_" + i + "_" + j);
		tile.className = "tile";
		// by default, none of the tiles have red font/border-color
		tile.classList.add("nohighlight");
		tile.style.top = px * i + "px";
		tile.style.left = px * j + "px";
		// (1 + size * i + j) gives the number that should be inside each tile
		tile.innerHTML = 1 + size * i + j;
		// background positions are negations of each tile's position
		tile.style.backgroundPosition = "-" + tile.style.left + " -" + tile.style.top;
		document.getElementById("puzzlearea").appendChild(tile);
	}

	// adds event listeners to each tile
	function setTileEventListeners() {
		let tiles = document.querySelectorAll(".tile");
		for(let i = 0; i < tiles.length; i++) {
			tiles[i].addEventListener("mouseover", highlight);
			tiles[i].addEventListener("mouseout", unhighlight);
			tiles[i].addEventListener("click", move);
			tiles[i].addEventListener("click", unhighlight);
		}
	}

	// adds class="highlight" to tiles that are "movable"
	function highlight() {
		if(isMovable(this)) {
			this.classList.remove("nohighlight");
			this.classList.add("highlight");
		}
	}

	// adds class="unhighlight" to tiles that are "not movable"
	function unhighlight() {
		this.classList.remove("highlight");
		this.classList.add("nohighlight");
	}

	// determines whether a tile is "movable" and returns true if so
	function isMovable(entry) {
		// figures out the ids of possible movable tiles
		let up = "tile_" + (blankRow - 1) + "_" + blankCol;
		let down = "tile_" + (blankRow + 1) + "_" + blankCol;
		let left = "tile_" + blankRow + "_" + (blankCol - 1);
		let right = "tile_" + blankRow + "_" + (blankCol + 1);
		let movables = [up, down, left, right];
		// checks if a tile's id is one of the possibilities
		return movables.indexOf(entry.id) != -1;
	}

	// moves a "movable" tile into the location of the blank square and then
	// checks for a solved state
	function move() {
		// first tile must be movable
		if(isMovable(this)) {
			// updates the tile's id to reflect new location
			this.id = "tile_" + blankRow + "_" + blankCol;
			// determines new values for blank square's row and column
			let blankRowNew = parseInt(this.style.top, 10) / px;
			let blankColNew = parseInt(this.style.left, 10) / px;
			// updates location of tile to the location of the blank square
			this.style.top = blankRow * px + "px";
			this.style.left = blankCol * px + "px";
			blankRow = blankRowNew;
			blankCol = blankColNew;
			// if shuffling id is -1 will skip displaying "You win".
			if(id != -1) {
				// board won't be solved without blank tile in bottom right corner
				if(blankRow == size - 1 && blankCol == size - 1 && isSolved()) {
					winner();
				}
				// if id != 0, setInterval is running and needs to be stopped
				else if(id != 0) {
					unwinner();
				}
			}
		}
	}

	// shuffles the tiles on the board by randomly switching the blank square
	// with an adjacent tile; shuffled board is in a solvable state; the number
	// of shuffles is scaled to the size of the board; if the shuffled board is
	// in a solved state, the board is re-shuffled
	function shuffle() {
		// stop setInterval if it is active
		if(id != 0) {
			unwinner();
		}
		// id = -1 allows skipping "You win" message while shuffling
		id = -1;
		// shuffling is always performed once and is repeated while the result
		// is a solved state
		do {
			// number of times to shuffle is scaled to be directly proportional
			// to number of tiles on board because 1000 shuffles on a 12x12
			// board was horribly insufficient
			// ex: size 4 -> 16 tiles -> 1024; size 8 -> 64 tiles -> 4096; etc.
			let numShuffles = Math.pow(size, 2) * 64;
			for(let i = 0; i < numShuffles; i++) {
				// determines ids for tiles that could be switched and loads
				// DOM objects into array
				let neighbors = [];
				neighbors.push(document.getElementById("tile_" + (blankRow - 1) + "_" + blankCol));
				neighbors.push(document.getElementById("tile_" + (blankRow + 1) + "_" + blankCol));
				neighbors.push(document.getElementById("tile_" + blankRow + "_" + (blankCol - 1)));
				neighbors.push(document.getElementById("tile_" + blankRow + "_" + (blankCol + 1)));
				// checks for null (falsey) objects and removes them from array
				for(let j = neighbors.length - 1; j >= 0; j--) {
					if(!neighbors[j]) {
						neighbors.splice(j, 1);
					}
				}
				// randomly clicks a remaining (non-null) object to call move()
				neighbors[Math.floor(Math.random() * neighbors.length)].click();
			}
		} while(isSolved());
		id = 0;
	}

	// determines if the board is in a solved state and returns true if so
	function isSolved() {
		for(let i = 0; i < size; i++) {
			for(let j = 0; j < size; j++) {
				let tile = document.getElementById("tile_" + i + "_" + j);
				if(i == size - 1 && j == size - 1) {
					// if both loops make it to the end, the board is solved
					return true;
				} else if(!tile) {
					// if null, it's a blank tile and not solved
					return false;
				} else if(parseInt(tile.innerHTML, 10) != 1 + size * i + j) {
					// if any tile's innerHTML doesn't match (1 + size * i + j)
					// then the board is not solved
					return false;
				}
			}
		}
	}

	// inserts a "You win" message into #output when game is in a solved state;
	// message changes to a random color every 200ms
	function winner() {
		document.getElementById("output").innerHTML = "You win! :]";
		// even better than "blink"!
		id = setInterval(discoColors, 200);
	}

	// changes the "You win" message to a random color
	function discoColors() {
		let r = Math.floor(Math.random() * 256);
		let g = Math.floor(Math.random() * 256);
		let b = Math.floor(Math.random() * 256);
		document.getElementById("output").style.color = "rgb(" + r + ", " + g + ", " + b + ")";
	}

	// removes the "You win" message and stops the random font color changes
	function unwinner() {
		clearInterval(id);
		document.getElementById("output").innerHTML = null;
		// setting to 0 allows for an easily-identifiable stopped setInterval
		id = 0;
	}

	// changes the board to a size by size game when an option is selected from
	// the drop-down menu; updates size and px, removes old tiles and places
	// new tiles on the board in initial (solved) state
	function resize() {
		// sets new values for size and px
		size = this.value;
		px = Math.round(400 / size);
		// get new tiles
		reset();
		// style tiles for new board size
		setStyleSettings();
	}

	// removes all tiles from the board and creates new tiles corresponding to
	// the new size value
	function reset() {
		// remove all tiles to create new board
		let tiles = document.querySelectorAll(".tile");
		for(let i = 0; i < tiles.length; i++) {
			document.getElementById("puzzlearea").removeChild(tiles[i]);
		}
		// create tiles using new size and px values
		createTiles();
		setTileEventListeners();
		// remove winning message if it is displayed
		if(id != 0) {
			unwinner();
		}
	}

	// adjusts style settings for the tiles according to the (new) size value
	function setStyleSettings() {
		let tiles = document.querySelectorAll(".tile");
		for(let i = 0; i < tiles.length; i++) {
			// border-width is 5px when size is 4 and less for larger sizes
			tiles[i].style.borderWidth = Math.round(20 / size) + "px";
			// subtract twice the border-width for height and width
			tiles[i].style.height = (px - 2 * Math.round(20 / size)) + "px";
			tiles[i].style.width = (px - 2 * Math.round(20 / size)) + "px";
			// font size is scaled to fit in smaller / larger tiles
			tiles[i].style.fontSize = Math.round(160 / size) + "pt";
		}
	}
})();
