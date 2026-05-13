const EPSILON = 1e-9;
const METERS_PER_DEGREE = 111320;
const MIN_COS_LAT = 1e-6;

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

export class FootprintScanLayer {
  constructor(options = {}) {
    this.map = null;

    this.sourceId = options.sourceId ?? 'petiteau-footprint-ring-scan-source';
    this.layerId = options.layerId ?? 'petiteau-footprint-ring-scan-layer';

    this.durationMs = Number.isFinite(options.durationMs)
      ? Math.max(1, Number(options.durationMs))
      : 6000;

    this.geometryOffsetMeters = Number.isFinite(options.geometryOffsetMeters)
      ? Math.max(0, Number(options.geometryOffsetMeters))
      : 0.12;

    this.defaultHeightMeters = Number.isFinite(options.defaultHeightMeters)
      ? Math.max(0.1, Number(options.defaultHeightMeters))
      : 10;

    this.minHeightMeters = Number.isFinite(options.minHeightMeters)
      ? Math.max(0.1, Number(options.minHeightMeters))
      : 2.5;

    this.scanColor = options.scanColor ?? '#26619C';
    this.arriveColor = options.arriveColor ?? '#40E0D0';

    this._rafId = null;
    this._animationToken = 0;
  }

  addTo(map) {
    if (!map) {
      console.warn('[FootprintScanLayer] addTo(map) failed: map is required.');
      return;
    }

    this.map = map;

    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
    }

    if (!this.map.getLayer(this.layerId)) {
      this.map.addLayer({
        id: this.layerId,
        type: 'fill-extrusion',
        source: this.sourceId,
        layout: {
          visibility: 'none',
        },
        paint: {
          'fill-extrusion-color': this.scanColor,
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      });
    }
  }

  startFromFeature(feature, options = {}) {
    if (!this.map?.getLayer(this.layerId)) return false;

    const source = this.map.getSource(this.sourceId);
    if (!source?.setData || !feature?.geometry) return false;

    const heightM = this._resolveHeightMeters(feature.properties ?? {}, options);
    const ringFeature = this._buildRingFeature(feature, heightM);

    if (!ringFeature) {
      this.stop();
      return false;
    }

    this._cancelAnimation();

    const durationMs = Number.isFinite(options.durationMs)
      ? Math.max(1, Number(options.durationMs))
      : this.durationMs;

    const bandWidthM = Number.isFinite(options.bandWidthM)
      ? Math.max(0.1, Number(options.bandWidthM))
      : 0.5;

    const color = options.color ?? this.scanColor;
    const initialBase = Math.max(0, heightM - bandWidthM);

    source.setData({
      type: 'FeatureCollection',
      features: [ringFeature],
    });

    this.map.setPaintProperty(this.layerId, 'fill-extrusion-color', color);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-height', heightM);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-base', initialBase);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-opacity', 0.92);
    this.map.setLayoutProperty(this.layerId, 'visibility', 'visible');

    const token = ++this._animationToken;
    const startTime = performance.now();

    const tick = (now) => {
      if (token !== this._animationToken || !this.map?.getLayer(this.layerId)) {
        return;
      }

      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1, elapsed / durationMs);
      const top = heightM * (1 - progress);
      const base = Math.max(0, top - bandWidthM);

      this.map.setPaintProperty(
        this.layerId,
        'fill-extrusion-height',
        Math.max(base + 0.01, top),
      );
      this.map.setPaintProperty(
        this.layerId,
        'fill-extrusion-base',
        base,
      );

      if (progress >= 1) {
        this._onArrive(heightM);
        return;
      }

      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
    return true;
  }

  stop() {
    this._cancelAnimation();

    if (this.map?.getLayer(this.layerId)) {
      this.map.setLayoutProperty(this.layerId, 'visibility', 'none');
    }

    const source = this.map?.getSource(this.sourceId);
    if (source?.setData) {
      source.setData(emptyFeatureCollection());
    }
  }

  _onArrive(heightM) {
    this._cancelAnimation();

    if (!this.map?.getLayer(this.layerId)) return;

    this.map.setPaintProperty(this.layerId, 'fill-extrusion-color', this.arriveColor);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-height', heightM);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-base', 0);
    this.map.setPaintProperty(this.layerId, 'fill-extrusion-opacity', 0.6);
  }

  _buildRingFeature(feature, heightM) {
    const polygons = this._extractPolygons(feature?.geometry);
    if (!polygons.length) return null;

    const centerLat = this._centerLat(polygons);
    const latPerMeter = 1 / METERS_PER_DEGREE;
    const lngPerMeter = 1 / (
      METERS_PER_DEGREE * Math.max(Math.cos((centerLat * Math.PI) / 180), MIN_COS_LAT)
    );
    const deltaLat = this.geometryOffsetMeters * latPerMeter;
    const deltaLng = this.geometryOffsetMeters * lngPerMeter;

    const donutPolygons = [];

    for (const polygon of polygons) {
      const outerRing = this._sanitizeRing(polygon?.[0]);
      if (outerRing.length < 3) continue;

      const offsetRing = this._offsetRing(outerRing, deltaLng, deltaLat);
      if (offsetRing.length < 4) continue;

      donutPolygons.push([
        offsetRing,
        this._closeRing(outerRing.slice().reverse()),
      ]);
    }

    if (!donutPolygons.length) return null;

    return {
      type: 'Feature',
      properties: {
        height: heightM,
      },
      geometry: donutPolygons.length === 1
        ? {
            type: 'Polygon',
            coordinates: donutPolygons[0],
          }
        : {
            type: 'MultiPolygon',
            coordinates: donutPolygons,
          },
    };
  }

  _offsetRing(ring, deltaLng, deltaLat) {
    const points = this._sanitizeRing(ring);
    if (points.length < 3) return [];

    const outwardScale = this._signedArea(points) >= 0 ? -1 : 1;
    const offset = [];

    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const current = points[i];
      const next = points[(i + 1) % points.length];

      const prevNormal = this._edgeNormal(prev, current, outwardScale);
      const nextNormal = this._edgeNormal(current, next, outwardScale);

      let nx = prevNormal[0] + nextNormal[0];
      let ny = prevNormal[1] + nextNormal[1];
      let len = Math.hypot(nx, ny);

      if (!Number.isFinite(len) || len <= EPSILON) {
        nx = nextNormal[0] || prevNormal[0];
        ny = nextNormal[1] || prevNormal[1];
        len = Math.hypot(nx, ny);
      }

      if (!Number.isFinite(len) || len <= EPSILON) {
        offset.push([current[0], current[1]]);
        continue;
      }

      offset.push([
        current[0] + (nx / len) * deltaLng,
        current[1] + (ny / len) * deltaLat,
      ]);
    }

    return this._closeRing(offset);
  }

  _edgeNormal(from, to, outwardScale) {
    const dx = Number(to?.[0]) - Number(from?.[0]);
    const dy = Number(to?.[1]) - Number(from?.[1]);
    const len = Math.hypot(dx, dy);

    if (!Number.isFinite(len) || len <= EPSILON) {
      return [0, 0];
    }

    return [
      (-dy / len) * outwardScale,
      (dx / len) * outwardScale,
    ];
  }

  _extractPolygons(geometry) {
    if (!geometry) return [];

    if (geometry.type === 'Polygon') {
      return [geometry.coordinates ?? []];
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates ?? [];
    }

    return [];
  }

  _centerLat(polygons) {
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const polygon of polygons) {
      const ring = polygon?.[0] ?? [];
      for (const coord of ring) {
        const lat = Number(coord?.[1]);
        if (!Number.isFinite(lat)) continue;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }

    if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      return 0;
    }

    return (minLat + maxLat) * 0.5;
  }

  _sanitizeRing(ring) {
    if (!Array.isArray(ring)) return [];

    const points = [];

    for (const coord of ring) {
      const lng = Number(coord?.[0]);
      const lat = Number(coord?.[1]);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push([lng, lat]);
    }

    if (points.length <= 1) return points;

    const first = points[0];
    const last = points[points.length - 1];

    if (first[0] === last[0] && first[1] === last[1]) {
      return points.slice(0, -1);
    }

    return points;
  }

  _closeRing(ring) {
    if (!Array.isArray(ring) || !ring.length) return [];

    const closed = ring.map((coord) => [coord[0], coord[1]]);
    const first = closed[0];
    const last = closed[closed.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1]) {
      closed.push([first[0], first[1]]);
    }

    return closed;
  }

  _signedArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;

    let sum = 0;

    for (let i = 0; i < ring.length; i++) {
      const current = ring[i];
      const next = ring[(i + 1) % ring.length];
      sum += (current[0] * next[1]) - (next[0] * current[1]);
    }

    return sum / 2;
  }

  _resolveHeightMeters(properties, options) {
    if (Number.isFinite(options.heightMeters)) {
      return Math.max(this.minHeightMeters, Number(options.heightMeters));
    }

    const keys = [
      'height',
      'measuredHeight',
      'h',
      'HEIGHT',
      'MeasuredHeight',
      'measured_height',
      'bldg:measuredHeight',
      'building_height',
      'render_height',
      'extrude_height',
      'max_height',
      '高さ',
      '建物高さ',
    ];

    for (const key of keys) {
      const n = this._toNumber(properties?.[key]);
      if (Number.isFinite(n) && n > 0) {
        return Math.max(this.minHeightMeters, n);
      }
    }

    return this.defaultHeightMeters;
  }

  _toNumber(value) {
    if (typeof value === 'number') return value;

    if (typeof value === 'string') {
      const cleaned = value
        .replace(/[ｍmメートル\s]/g, '')
        .replace(/,/g, '');

      const n = Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
  }

  _cancelAnimation() {
    this._animationToken += 1;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}
