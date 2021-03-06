function MergeDiagram(container, options) {
	this.container = container || $('<div></div>').appendTo($('body'));
	this.canvas = $('<canvas></canvas>').appendTo(this.container);

	this.options = {
		orient: 'top', // or 'bottom, left, right', means the position of the root node
		expansion: 'single',  // or 'double'
		maxround: 99,
		needbus: true,
		padding: 0, // or { left: 0, right: 0, top: 0, bottom: 0 }
		cell: {
			width: 120,
			height: 90,
			padding: 30, // the distance between 2 sibling cells
			template: '<div class="match-item" style="text-align: center; border: solid 1px red;"><%- name %></div>'
		},
		linker: {
			bus: {
				color: 'black'
			},
			input: { // child's side
				offset: 0,
				color: 'green',
				height: 50
			},
			output: { // parent's side
				color: 'blue',
				height: 40
			}
		}
	};
	this.config(options);
}

MergeDiagram.prototype = {
	constructor: MergeDiagram,
	config: function(options) {
		this.options = $.extend(true, this.options, options || {});

		// the orientation of the same level cells
		this.isHorizontal = this.options.orient == 'top' || this.options.orient == 'bottom';
		// the total height of the linker
		this.linkerHeight = this.options.linker.input.height + this.options.linker.output.height;
	},
	draw: function() {
		if (!this.options.data || !_.keys(this.options.data).length) return;

		this.cellTemplate = _.template(this.options.cell.template);

		// turn string reference into object reference
		this.buildCellRelations();

		// calculation
		this.calculateLevel();
		this.calculateCoordinate();
		this.calculateSize();

		// draw each cell and linker
		this.doDraw();
	},

	buildCellRelations: function() {
		var self = this, child;

		_.each(this.options.data, function(value, key) {
			if (!value.children) return true;

			_.each(value.children, function(str, i) {
				child = self.options.data[str];
				if (!child.parents) child.parents = [];
				child.parents.push(value);

				value.children[i] = child;
			});
		});
	},

	calculateLevel: function() {
		var self = this,
			minLevel = 0,
			roots = self.findRoots(), leafs = self.findLeafs();

		// calculate all possible levels of each root
		_.each(leafs, function(leaf, i) {
			leaf.levels = [0];
			self.travelByLevel(leaf, function(cell) {
				self.updateFieldLevels(cell, 'parents', cell.levels[cell.levels.length - 1] - 1);
			}, 'parents');
		});

		// only pick the smallest level
		_.each(roots, function(root, i) {
			root.level = _.min(root.levels);
			if (root.level < minLevel) minLevel = root.level;

			self.travelByLevel(root, function(cell) {
				_.each(cell.children, function(child) {
					if (!_.isUndefined(child.level) && child.level >= cell.level + 1) return;

					child.level = cell.level + 1;
				});
			});
		});

		// generate the level map with 0 as the base level
		self.levelMap = {};
		_.each(self.options.data, function(cell, i) {
			cell.level -= minLevel;
			cell.levels = null;

			if (!self.levelMap[cell.level]) self.levelMap[cell.level] = [];
			self.levelMap[cell.level].push(cell);
		});
	},
	updateFieldLevels: function(cell, field, level) {
		if (!cell[field] || !cell[field].length) return;

		_.each(cell[field], function(other, i) {
			if (!other.levels) other.levels = [];
			other.levels.push(level);
		});
	},
	
	calculateCoordinate: function() {
		var self = this,
			x, y;

		var longestLevel = _.max(_.keys(self.levelMap, function(level) {
			return self.levelMap[key].length;
		})), longestCount = self.levelMap[longestLevel].length;

		// initilize with standard position
		_.each(self.levelMap, function(list, level) {
			_.each(list, function(cell, i) {
				cell.x = self.getStandardX(i);
				cell.y = self.getStandardY(cell.level);
			});
		});

		// loop to adjust to the balanced position
		var round = 0,
			threshold = 10,
			prevVector, curVector, changed;
		while (round++ < self.options.maxround) {
			prevVector = curVector;
			curVector = {};

			_.each(self.levelMap, function(list, level) {
				_.each(list, function(cell, i) {
					cell.prevX = cell.x;
					cell.x = self.getBalancedX(cell);
				});
				self.expandCellList(list);

				curVector[level] = 0;
				_.each(list, function(cell, i) {
					curVector[level] += Math.abs(cell.x - cell.prevX);
				});
			});

			changed = 0;
			_.each(self.levelMap, function(list, level) {
				changed += Math.abs(curVector[level] - (prevVector ? prevVector[level] : 0));
			});
			if (changed < threshold) {
				break;
			}
		}
		console.log('Total round=' + round);
	},
	getStandardX: function(index) {
		return index * (this.options.cell.width + this.options.cell.padding);
	},
	getStandardY: function(level) {
		return level * (this.options.cell.height + this.linkerHeight) + this.options.cell.height;
	},
	getCenterX: function(list) {
		var min = _.min(list, 'x');
			max = _.max(list, 'x');

		return (min.x + max.x) / 2;
	},
	getBalancedX: function(cell) {
		var self = this,
			list,
			force = 0;

		if (cell.parents && cell.parents.length == 1) {
			list = $.extend([], cell.children);
		} else {
			list = $.extend([], cell.children, cell.parents);
		}

		_.each(list, function(other, i) {
			force += self.getForce(cell, other);
		});

		return list.length ? cell.x + force / list.length : cell.x;
	},
	getForce: function(c1, c2) {
		return c2.x - c1.x;
	},

	expandCellList: function(list) {
		var self = this,
			zoneList = [],
			current;

		// covert to internal list
		list = _.sortBy(list, 'x');

		_.each(list, function(cell, i) {
			if (!current || current.right <= cell.x) {
				current = {
					left: cell.x,
					right: cell.x + self.options.cell.width + self.options.cell.padding,
					cells: [cell]
				};
				zoneList.push(current);
			} else {
				current.right = cell.x + self.options.cell.width + self.options.cell.padding;
				current.cells.push(cell);
			}
		});

		// expand each internal
		_.each(zoneList, function(zone, i) {
			zone.width = zone.cells.length * (self.options.cell.width + self.options.cell.padding);

			// expand based on the center
			zone.center = self.getExpandCenter(zone.cells);
			zone.left = zone.center - zone.width / 2;

			if (i != 0 && zone.left < zoneList[i - 1].right) {
				zone.left = zoneList[i - 1].right;
			}
			zone.right = zone.left + zone.width;
		});

		// update x and y
		_.each(zoneList, function(zone) {
			_.each(zone.cells, function(cell, i) {
				cell.x = zone.left + self.getStandardX(i);
			});
		});
	},
	getExpandCenter: function(list) {
		var xSum = _.reduce(list, function(memo, cell) {
			return memo + cell.x;
		}, 0);
		return xSum / list.length + (this.options.cell.width + this.options.cell.padding) / 2;
	},

	isConfirmedList: function(list) {
		if (!list || !list.length) return false;

		var self = this;
		return _.every(list, function(cell, i) {
			return self.isConfirmedCell(cell);
		});
	},
	isConfirmedCell: function(cell) {
		return !_.isUndefined(cell.x);
	},
	
	calculateSize: function() {
		var self = this;

		self.minX = _.min(self.options.data, 'x').x;
		self.maxX = _.max(self.options.data, 'x').x;
		self.minY = _.min(self.options.data, 'y').y;
		self.maxY = _.max(self.options.data, 'y').y;

		self.width = (self.maxX - self.minX + self.options.cell.width);
		self.height = (self.maxY - self.minY + self.options.cell.height);
		self.canvas.attr(self.isHorizontal ? 'width' : 'height', self.width + 'px');
		self.canvas.attr(self.isHorizontal ? 'height' : 'width', self.height + 'px');
		self.context2d = self.canvas.get(0).getContext('2d');
		self.container.css('width', self.canvas.attr('width'));
		self.container.css('height', self.canvas.attr('height'));
	},

	findRoots: function() {
		var roots = [];
		_.each(this.options.data, function(value, key) {
			if (!value.parents || !value.parents.length) {
				roots.push(value);
			}
		});
		return roots;
	},
	findLeafs: function() {
		var leafs = [];
		_.each(this.options.data, function(value, key) {
			if (!value.children || !value.children.length) {
				leafs.push(value);
			}
		});
		return leafs;
	},
	travelByPostOrder: function(root, iteratee) {
		var self = this,
			stack = [root], cell;

		while (stack.length) {
			cell = stack.pop();
			if (!cell.visited) {
				cell.visited = true;
				stack.push(cell);
				stack = stack.concat(cell.children);
			} else {
				cell.visited = false;
				iteratee(cell);
			}
		}
	},
	travelByLevel: function(root, iteratee, field) {
		var q = [root], cell;

		field = field || 'children';
		while(q.length) {
			cell = q.shift();
			if (cell[field] && cell[field].length) {
				q = q.concat(cell[field]);
			}

			iteratee(cell);
		}
	},

	doDraw: function() {
		var self = this,
			html, css,
			busStartX, busStartY, busEndX, busEndY;

		self.container.css('position', 'relative');
		_.each(this.options.data, function(value, key) {
			// draw the cell
			css = $.extend({
				position: 'absolute',
				width: self.isHorizontal ? self.options.cell.width : self.options.cell.height,
				height: self.isHorizontal ? self.options.cell.height : self.options.cell.width
			}, self.translateXY(value.x, value.y));

			html = self.cellTemplate(value.data);
			$(html).css(css).appendTo(self.container);

			// draw the line between the cell and its parent's bus
			_.each(_.sortBy(value.parents, 'x'), function(parent, i) {
				var busY = parent.y + self.options.cell.height + self.options.linker.output.height,
					x = value.x + self.options.cell.width / 2 + (i - value.parents.length / 2) * self.options.linker.input.offset,
					y = busY < value.y ? value.y : value.y + self.options.cell.height;

				self.context2d.beginPath();
				self.context2d.strokeStyle = self.options.linker.input.color;
				self.drawLine(
					x,
					y,
					self.options.needbus ? 0 : parent.x + self.options.cell.width / 2 - x,
					busY - y
				);
			});

			// draw the bus and connect the cell with the bus
			if (!value.children || !value.children.length) return true;

			busStartX = busEndX = value.x + self.options.cell.width / 2;
			busStartY = busEndY = value.y + self.options.cell.height + self.options.linker.output.height;

			_.each(value.children, function(child, i) {
				var x = child.x + self.options.cell.width / 2;

				if (x < busStartX) busStartX = x;
				if (x > busEndX) busEndX = x;
			});

			self.context2d.beginPath();
			self.context2d.strokeStyle = self.options.linker.bus.color;
			self.options.needbus && self.drawLine(busStartX, busStartY, busEndX - busStartX, busEndY - busStartY);

			self.context2d.beginPath();
			self.context2d.strokeStyle = self.options.linker.output.color;
			self.drawLine(value.x + self.options.cell.width / 2, busStartY, 0, -self.options.linker.output.height);
		});
	},
	drawLine: function(x, y, xDelta, yDelta) {
		var obj1 = this.translateXY(x, y),
			obj2 = this.translateXY(x + xDelta, y + yDelta);

		this.context2d.moveTo(obj1.x, obj1.y);
		this.context2d.lineTo(obj2.x, obj2.y);
		this.context2d.stroke();
	},
	translateXY: function(x, y) {
		var obj = {};
		x -= this.minX;
		y -= this.minY;

		// for elements, use top/bottom/left/right
		// for points, use x/y
		switch (this.options.orient) {
			case 'top':
				obj.left = obj.x = x;
				obj.top = obj.y = y;
				break;
			case 'bottom':
				obj.right = x;
				obj.bottom = y;
				obj.x = this.width - x;
				obj.y = this.height - y;
				break;
			case 'left':
				obj.left = obj.x = y;
				obj.bottom = x;
				obj.y = this.width - x;
				break;
			case 'right':
				obj.top = obj.y = x;
				obj.right = y;
				obj.x = this.height - y;
				break;
		}
		return obj;
	}
}