// Sets "Agent Graph Builder · Open-Source Software" above "AGBoss" in the page title.
// Source: <p class="agp-acronym" id="agp-acronym"> in the page; removed once used.
(function () {
	var src = document.getElementById('agp-acronym');
	var h = document.querySelector('h1#_top');
	if (!src || !h) return;
	var note = [
		['A', 'gent'],
		['G', 'raph'],
		['B', 'uilder'],
		['O', 'pen-'],
		['S', 'ource'],
		['S', 'oftware'],
	]
		.map(function (w) {
			return '<b>' + w[0] + '</b>' + w[1];
		})
		.join(' ')
		.replace('uilder ', 'uilder · ')
		.replace('- ', '-');
	h.innerHTML = '<span class="agp-tagged">AGBoss<span class="agp-tag">' + note + '</span></span> ' + h.innerHTML;
	src.remove();
})();
