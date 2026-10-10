(function () {
	var TYPE_MS = 75;
	var DELETE_MS = 40;
	var HOLD_MS = 1700;
	var GAP_MS = 350;

	function init() {
		var el = document.getElementById("hero-rotator");
		if (!el) { return; }
		var words = Array.prototype.map.call(el.querySelectorAll(".hero-trait"), function (n) {
			return n.textContent;
		});
		if (!words.length) { return; }

		var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		el.textContent = "";
		el.classList.add("is-typing");
		el.setAttribute("aria-label", words.join(", "));
		var typed = document.createElement("span");
		typed.className = "hero-typed";
		typed.setAttribute("aria-hidden", "true");
		var caret = document.createElement("span");
		caret.className = "hero-caret";
		caret.setAttribute("aria-hidden", "true");
		el.appendChild(typed);
		el.appendChild(caret);

		var w = 0;

		if (reduce) {
			typed.textContent = words[0];
			setInterval(function () {
				w = (w + 1) % words.length;
				typed.textContent = words[w];
			}, 2500);
			return;
		}

		function type(i) {
			typed.textContent = words[w].slice(0, i);
			if (i < words[w].length) {
				setTimeout(function () { type(i + 1); }, TYPE_MS);
			} else {
				caret.classList.add("is-blinking");
				setTimeout(function () {
					caret.classList.remove("is-blinking");
					erase(words[w].length);
				}, HOLD_MS);
			}
		}

		function erase(i) {
			typed.textContent = words[w].slice(0, i);
			if (i > 0) {
				setTimeout(function () { erase(i - 1); }, DELETE_MS);
			} else {
				w = (w + 1) % words.length;
				setTimeout(function () { type(1); }, GAP_MS);
			}
		}

		type(1);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
