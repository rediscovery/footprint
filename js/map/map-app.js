/**
 * map-app.js v26-footprint-ring-scan
 * - LOD2 mesh raycast 優先版
 * - feature.id / setFeatureState() を使わない
 * - LOD2 ON 時は GLB mesh を先に raycast
 * - LOD2 mesh に当たれば footprint HIT へ進まない
 * - LOD2 mesh に当たらない場合だけ footprint HIT に fallback
 * - Footprint 選択時のレーザーは MapLibre fill-extrusion のリングスキャンで描画
 */
import { state } from '../state.js';
import { VegetationManager } from './vegetation-manager.js';
import { StyleTuner } from './style-tuner.js';
import { CameraController } from './camera-controller.js';
import { RoadGlbLayer } from '../glb/road-glb-layer.js';
import { GlbCombinedLayer } from '../glb/glb-combined-layer.js';
import { FootprintScanLayer } from '../effects/footprint-scan-layer.js';

const AREAS_JSON_URL = 'bldg_luse/areas.json';

const INITIAL_CENTER = [135.42834, 34.82156];
const INITIAL_ZOOM   = 16;
const INITIAL_PITCH  = 50;
const MAX_PITCH      = 60;
const IKEDA_SHARED_ORIGIN = [135.412500000175, 34.783333333767];

const HILLSHADE_TILE_URL  = 'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png';
const HILLSHADE_SOURCE_ID = 'gsi-hillshade-source';
const HILLSHADE_LAYER_ID  = 'gsi-hillshade-underlay';
const HILLSHADE_OPACITY   = 0.18;

const FOOTPRINT_SOURCE    = 'petiteau-bldg-footprint';
const FOOTPRINT_FILL      = 'petiteau-bldg-footprint-fill';
const FOOTPRINT_LINE      = 'petiteau-bldg-footprint-line';
const FOOTPRINT_EXTRUSION = 'petiteau-bldg-footprint-extrusion';
const FOOTPRINT_HIT       = 'petiteau-bldg-footprint-hit';

const SELECTED_BUILDING_SOURCE    = 'petiteau-selected-building-source';
const SELECTED_BUILDING_FILL      = 'petiteau-selected-building-fill';
const SELECTED_BUILDING_LINE      = 'petiteau-selected-building-line';
const SELECTED_BUILDING_EXTRUSION = 'petiteau-selected-building-extrusion';
const SELECTED_BUILDING_HEIGHT_SCAN = 'petiteau-selected-building-height-scan';

const BG_LAYER_ID = 'petiteau-background';

const ZOOM_3D_THRESHOLD   = 15.6;
const ZOOM_LOD2_THRESHOLD = 15.6;

const FP_FILL_COLOR        = '#e7eaf3';
const FP_LINE_COLOR        = '#3d607b';
const FP_LINE_WIDTH        = 0.4;
const DEFAULT_GROUND_COLOR = '#e9e8f2';

// 照明デフォルト（LOD1・LOD2共通）
const DEFAULT_SUN_AZIMUTH       = 204;
const DEFAULT_SUN_ELEVATION     = 77;
const DEFAULT_SUN_INTENSITY     = 0.29;
const DEFAULT_AMBIENT_INTENSITY = 1.0;

// LOD2 専用色
const DEFAULT_LOD2_ROOF_COLOR = '#ffffff';
const DEFAULT_LOD2_WALL_COLOR = '#d0ccdb';

const BASE_STYLE_URL = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/std.json';

// ═══════════════════════════════════════════════════════════════
// URL 絶対化
// ═══════════════════════════════════════════════════════════════

function absolutizeUrl(url, base) {
  if (!url || typeof url !== 'string') return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function absolutizeTemplateUrl(url, base) {
  if (!url || typeof url !== 'string') return url;

  const placeholders = [];

  const protected_ = url.replace(/\{[^}]+\}/g, (m) => {
    const token = `__TPL_${placeholders.length}__`;
    placeholders.push([token, m]);
    return token;
  });

  try {
    let resolved = new URL(protected_, base).toString();

    for (const [token, original] of placeholders) {
      resolved = resolved.replaceAll(token, original);
    }

    return resolved;
  } catch {
    return url;
  }
}

// ═══════════════════════════════════════════════════════════════
// スタイル事前変換
// ═══════════════════════════════════════════════════════════════

function _layerText(layer) {
  return JSON.stringify({
    id: layer.id,
    type: layer.type,
    source: layer.source,
    sourceLayer: layer['source-layer'],
    filter: layer.filter,
    layout: layer.layout,
    paint: layer.paint,
    metadata: layer.metadata,
  }).toLowerCase();
}

function _looksLikeWater(t) {
  return /water|river|lake|stream|canal|coastline|海|河川|湖|水域/.test(t);
}

function _looksLikeVegetation(t) {
  return /park|forest|wood|green|grass|farmland|landuse|lc_|公園|森林|緑/.test(t);
}

function _looksLikeBuilding(t) {
  return /building|bldg|建物|建築|普通建物|堅ろう建物|無壁舎/.test(t);
}

function _looksLikeContour(t) {
  return /contour|等高線|isobath/.test(t);
}

function preProcessStyle(styleJson, baseUrl, groundColor = DEFAULT_GROUND_COLOR) {
  if (styleJson.sprite) styleJson.sprite = absolutizeUrl(styleJson.sprite, baseUrl);
  if (styleJson.glyphs) styleJson.glyphs = absolutizeTemplateUrl(styleJson.glyphs, baseUrl);

  if (styleJson.sources) {
    for (const src of Object.values(styleJson.sources)) {
      if (!src) continue;

      if (Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map((u) => absolutizeTemplateUrl(u, baseUrl));
      }

      if (typeof src.url === 'string') {
        src.url = absolutizeUrl(src.url, baseUrl);
      }

      if (typeof src.data === 'string') {
        src.data = absolutizeUrl(src.data, baseUrl);
      }
    }
  }

  for (const layer of styleJson.layers || []) {
    if (!layer) continue;

    layer.paint  = layer.paint  || {};
    layer.layout = layer.layout || {};

    const t = _layerText(layer);

    if (layer.type === 'background') {
      layer.paint['background-color'] = groundColor;
      continue;
    }

    if (layer.type === 'hillshade') {
      layer.paint['hillshade-shadow-color']    = '#8a9098';
      layer.paint['hillshade-highlight-color'] = '#f0ede6';
      layer.paint['hillshade-exaggeration']    = 0.14;
      continue;
    }

    if (layer.type === 'fill') {
      if (_looksLikeWater(t)) {
        layer.paint['fill-color']   = '#9dd4e8';
        layer.paint['fill-opacity'] = 0.92;
      } else if (_looksLikeVegetation(t)) {
        layer.paint['fill-color']   = '#c8dfb0';
        layer.paint['fill-opacity'] = 0.65;
      } else if (_looksLikeBuilding(t)) {
        layer.paint['fill-color']   = '#f4f5f7';
        layer.paint['fill-opacity'] = 0.0;
      } else {
        layer.paint['fill-color']         = groundColor;
        layer.paint['fill-opacity']       = 1.0;
        layer.paint['fill-outline-color'] = groundColor;
      }
      continue;
    }

    if (layer.type === 'line') {
      if (_looksLikeWater(t)) {
        layer.paint['line-color']   = '#7ec8e3';
        layer.paint['line-opacity'] = 0.9;
      } else if (_looksLikeContour(t)) {
        layer.paint['line-color']   = '#9fbc6f';
        layer.paint['line-opacity'] = 0.48;

        if (!layer.paint['line-width']) {
          layer.paint['line-width'] = 0.5;
        }
      }
      continue;
    }
  }

  return styleJson;
}

// ═══════════════════════════════════════════════════════════════
// MapApp
// ═══════════════════════════════════════════════════════════════

export class MapApp {
  constructor() {
    this.map               = null;
    this.vegetationManager = null;
    this.tranLayer         = null;
    this.lod2Layer         = null;
    this.footprintScanLayer = null;
    this.styleTuner        = null;
    this.cameraController  = null;
    this._listeners        = {};
    this._lod2Active       = null;
    this._groundColor      = DEFAULT_GROUND_COLOR;
    this._glbDLon          = 0;
    this._glbDLat          = 0;
    this._clickHandlersAttached = false;
    this._heightScanStartToken = 0;

    const scanDefaultIsMobile =
      typeof window !== 'undefined' &&
      window.innerWidth <= 720;

    // レーザースキャン幅の初期値:
    // PC = 0.2m / mobile = 0.3m
    this._heightScanBandWidthM = scanDefaultIsMobile ? 0.3 : 0.2;
    this._heightScanColor = '#ffffff';

    this._footprintHeightScanToken = 0;

    // 照明状態
    this._sunAzimuth       = DEFAULT_SUN_AZIMUTH;
    this._sunElevation     = DEFAULT_SUN_ELEVATION;
    this._sunIntensity     = DEFAULT_SUN_INTENSITY;
    this._ambientIntensity = DEFAULT_AMBIENT_INTENSITY;

    this.footprintSourceLayer = 'bldg_footprint';

    this.footprintStyle = {
      fillColor:   FP_FILL_COLOR,
      fillOpacity: 1.0,
      lineColor:   FP_LINE_COLOR,
      lineOpacity: 0.76,
      lineWidth:   FP_LINE_WIDTH,

      lod2RoofColor: DEFAULT_LOD2_ROOF_COLOR,
      lod2WallColor: DEFAULT_LOD2_WALL_COLOR,
    };
  }

  // ── 初期化 ──────────────────────────────────────────────────

  async init(containerId) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

    const baseUrl = new URL(BASE_STYLE_URL, location.href).toString();

    const res = await fetch(BASE_STYLE_URL);
    if (!res.ok) {
      throw new Error(`style fetch failed: ${res.status}`);
    }

    const rawStyle = await res.json();
    const tuned    = preProcessStyle(rawStyle, baseUrl, this._groundColor);

    this.map = new maplibregl.Map({
      container: containerId,
      style: tuned,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: 0,
      antialias: true,
    });

    window.__map = this.map;
    this.cameraController = new CameraController(this.map);

    await new Promise((resolve) => this.map.once('style.load', resolve));

    this.map.getCanvas().style.background = this._groundColor;

    if (!this.map.getLayer(BG_LAYER_ID)) {
      const firstLayerId = this.map.getStyle().layers[0]?.id;

      this.map.addLayer(
        {
          id: BG_LAYER_ID,
          type: 'background',
          paint: {
            'background-color': this._groundColor,
          },
        },
        firstLayerId,
      );
    }

    this.styleTuner = new StyleTuner(this.map);
    this.styleTuner.apply();

    this._applyMapLibreLight();
    this._insertHillshadeUnderlay();

    const areas = await this._loadAreas();

    if (!areas.length) {
      console.error('[MapApp] areas.json is empty');
      return;
    }

    await this._selectArea(areas[0]);

    this.map.on('zoom', () => this._onZoom());
    this._onZoom();

    this._emit('ready', {
      map: this.map,
      area: state.selectedArea,
    });
  }

  // ── 陰影起伏図 ───────────────────────────────────────────────

  _insertHillshadeUnderlay() {
    const map = this.map;

    if (!map.getSource(HILLSHADE_SOURCE_ID)) {
      map.addSource(HILLSHADE_SOURCE_ID, {
        type: 'raster',
        tiles: [HILLSHADE_TILE_URL],
        tileSize: 256,
        maxzoom: 16,
        attribution: '地理院タイル 陰影起伏図',
      });
    }

    if (map.getLayer(HILLSHADE_LAYER_ID)) {
      map.removeLayer(HILLSHADE_LAYER_ID);
    }

    const firstVectorLayer = (map.getStyle()?.layers ?? []).find(
      (l) => l.type !== 'background' && l.type !== 'raster',
    );

    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: 'raster',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'raster-opacity': HILLSHADE_OPACITY,
          'raster-resampling': 'linear',
        },
      },
      firstVectorLayer?.id,
    );
  }

  // ── エリア選択 ───────────────────────────────────────────────

  async _loadAreas() {
    try {
      const res = await fetch(AREAS_JSON_URL);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      console.error('[MapApp] Failed to load areas.json:', err);
      return [];
    }
  }

  async _selectArea(area) {
    state.selectedArea = area;
    state.areaBasePath = `bldg_luse/${area.path}`;

    const areaBase = state.areaBasePath;

    this.map.jumpTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: 0,
    });

    await this._addFootprintLayers(areaBase);
    this._setupFootprintScanLayer();

    this.vegetationManager = new VegetationManager(this.map);
    await this.vegetationManager.load(area, areaBase);

    await this._setupTranLayer(area, areaBase);
    await this._setupLod2Layer(area, areaBase);

    this._attachClickHandlers();

    this._emit('areaLoaded', { area });
  }

  // ── Footprint PMTiles ────────────────────────────────────────

  async _addFootprintLayers(areaBase) {
    const footprintRelUrl = `${areaBase}/bldg/footprint/bldg_footprint.pmtiles`;
    const footprintAbsUrl = new URL(footprintRelUrl, window.location.href).href;

    this.footprintSourceLayer = await this._detectFootprintSourceLayer(
      areaBase,
      footprintAbsUrl,
    );

    this._removeSelectedBuildingLayers();

    if (this.map.getSource(FOOTPRINT_SOURCE)) {
      [
        FOOTPRINT_HIT,
        FOOTPRINT_EXTRUSION,
        FOOTPRINT_LINE,
        FOOTPRINT_FILL,
      ].forEach((id) => {
        if (this.map.getLayer(id)) {
          this.map.removeLayer(id);
        }
      });

      this.map.removeSource(FOOTPRINT_SOURCE);
    }

    this.map.addSource(FOOTPRINT_SOURCE, {
      type: 'vector',
      url: `pmtiles://${footprintAbsUrl}`,
    });

    this.map.addLayer({
      id: FOOTPRINT_FILL,
      type: 'fill',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'fill-color': this._footprintFillColorExpr(),
        'fill-opacity': this._footprintFillOpacityExpr(),
      },
    });

    this.map.addLayer({
      id: FOOTPRINT_LINE,
      type: 'line',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'line-color': this._footprintLineColorExpr(),
        'line-width': this._footprintLineWidthExpr(),
        'line-opacity': this._footprintLineOpacityExpr(),
      },
    });

    this.map.addLayer({
      id: FOOTPRINT_EXTRUSION,
      type: 'fill-extrusion',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 15,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'fill-extrusion-color': this._footprintExtrusionColorExpr(),
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'height'],
          ['get', 'measuredHeight'],
          ['get', 'h'],
          10,
        ],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': this.footprintStyle.fillOpacity,
      },
    });

    // クリック判定専用 layer。
    // 表示用 footprint が OFF でも、LOD2 が ON なら fallback 選択に使える。
    this.map.addLayer({
      id: FOOTPRINT_HIT,
      type: 'fill',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0.01,
      },
    });

    this._addSelectedBuildingLayers();
  }

  _addSelectedBuildingLayers() {
    this._removeSelectedBuildingLayers();

    this.map.addSource(SELECTED_BUILDING_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_FILL,
      type: 'fill',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 14,
      layout: {
        visibility: 'none',
      },
      paint: {
        'fill-color': '#00ffff',
        'fill-opacity': 0.42,
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_LINE,
      type: 'line',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 14,
      layout: {
        visibility: 'none',
      },
      paint: {
        'line-color': '#00d9e6',
        'line-width': 2.2,
        'line-opacity': 1.0,
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_EXTRUSION,
      type: 'fill-extrusion',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 15,
      layout: {
        visibility: 'none',
      },
      paint: {
        'fill-extrusion-color': '#00ffff',
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'height'],
          ['get', 'measuredHeight'],
          ['get', 'h'],
          10,
        ],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.5,
      },
    });


  }


  _setupFootprintScanLayer() {
    if (!this.map) {
      console.warn('[MapApp] _setupFootprintScanLayer skipped: map is not ready.');
      return;
    }

    if (!this.footprintScanLayer) {
      this.footprintScanLayer = new FootprintScanLayer({
        sourceId: 'petiteau-footprint-ring-scan-source',
        layerId: 'petiteau-footprint-ring-scan-layer',
        durationMs: 6000,
        geometryOffsetMeters: 0.12,
        defaultHeightMeters: 10,
        minHeightMeters: 2.5,
        scanColor: '#26619C',
        arriveColor: '#40E0D0',
      });

      this.footprintScanLayer.addTo(this.map);
    }
  }

  _removeSelectedBuildingLayers() {
    [
      // Legacy fill-extrusion scan layer id. The new footprint ring scan layer
      // is managed independently by FootprintScanLayer.
      SELECTED_BUILDING_HEIGHT_SCAN,
      SELECTED_BUILDING_EXTRUSION,
      SELECTED_BUILDING_LINE,
      SELECTED_BUILDING_FILL,
    ].forEach((id) => {
      if (this.map?.getLayer(id)) {
        this.map.removeLayer(id);
      }
    });

    if (this.map?.getSource(SELECTED_BUILDING_SOURCE)) {
      this.map.removeSource(SELECTED_BUILDING_SOURCE);
    }
  }

  async _detectFootprintSourceLayer(areaBase, footprintAbsUrl) {
    const fromPmtiles = await this._sourceLayerFromPmtilesMetadata(footprintAbsUrl);
    if (fromPmtiles) return fromPmtiles;

    const fromSnippet = await this._sourceLayerFromSnippet(areaBase);
    if (fromSnippet) return fromSnippet;

    return 'bldg_footprint';
  }

  async _sourceLayerFromPmtilesMetadata(footprintAbsUrl) {
    try {
      if (!window.pmtiles?.PMTiles) return null;

      const archive  = new window.pmtiles.PMTiles(footprintAbsUrl);
      const metadata = await archive.getMetadata();
      const vl       = metadata?.vector_layers;

      if (Array.isArray(vl) && vl.length > 0 && vl[0]?.id) {
        return vl[0].id;
      }
    } catch (err) {
      console.warn('[MapApp] Could not read PMTiles metadata:', err);
    }

    return null;
  }

  async _sourceLayerFromSnippet(areaBase) {
    const candidates = [
      `${areaBase}/bldg/manifest/bldg_footprint_maplibre_snippet.json`,
      `${areaBase}/bldg/footprint/bldg_footprint_maplibre_snippet.json`,
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;

        const json = await res.json();
        if (json?.source_layer) return json.source_layer;
      } catch (_) {}
    }

    return null;
  }

  // ── GLB レイヤーセットアップ ──────────────────────────────────

  async _setupTranLayer(area, areaBase) {
    this.tranLayer = new RoadGlbLayer({
      area,
      areaBase,
    });

    this.map.addLayer(this.tranLayer);

    await this.tranLayer.init();

    this.tranLayer.setVisible(state.tranGlbEnabled ?? true);

    if (this._glbDLon !== 0 || this._glbDLat !== 0) {
      this.tranLayer.setOriginOffset(this._glbDLon, this._glbDLat);
    }
  }

  async _setupLod2Layer(area, areaBase) {
    const sharedOrigin = area.glbOrigin ?? IKEDA_SHARED_ORIGIN;

    this.lod2Layer = new GlbCombinedLayer({
      areaBase,
      sharedOrigin,
    });

    this.map.addLayer(this.lod2Layer);

    // GLBを追加した後にStyleTunerを再適用し、
    // 駅名・町名ラベルを建物より上のレイヤーに引き上げる
    if (this.styleTuner) {
      this.styleTuner.apply();
    }

    if (this.lod2Layer?.setBuildingColor) {
      this.lod2Layer.setBuildingColor(this.footprintStyle.lod2RoofColor);
    }

    if (this.lod2Layer?.setWallColor) {
      this.lod2Layer.setWallColor(this.footprintStyle.lod2WallColor);
    }

    this.lod2Layer.setLighting({
      azimuth: this._sunAzimuth,
      elevation: this._sunElevation,
      sunIntensity: this._sunIntensity,
      ambientIntensity: this._ambientIntensity,
    });

    const indexUrl = `${areaBase}/bldg/lod2_hollow_chome_index.json`;
    await this.lod2Layer.loadIndex(indexUrl);

    if (this._glbDLon !== 0 || this._glbDLat !== 0) {
      this.lod2Layer.setOriginOffset(this._glbDLon, this._glbDLat);
    }

    this._onZoom();
  }

  // ── MapLibre ライト（LOD1 fill-extrusion 用） ─────────────────

  _applyMapLibreLight() {
    try {
      const polar = 90 - this._sunElevation;

      this.map.setLight({
        anchor: 'map',
        color: 'white',
        intensity: this._sunIntensity,
        position: [1.5, this._sunAzimuth, polar],
      });
    } catch (err) {
      console.warn('[MapApp] setLight failed:', err);
    }
  }

  // ── ズーム連動 ───────────────────────────────────────────────

  _onZoom() {
    const zoom = this.map.getZoom();

    // v3: 表示は常に通常状態を維持する。
    // activeBuildingLayerMode は「選択可否」だけに使い、
    // footprint / LOD2 の表示切替には使わない。
    const footprintVisible = state.footprintEnabled;
    const hitEnabled = state.footprintEnabled;

    const show2D = footprintVisible && zoom >= 14 && zoom < ZOOM_3D_THRESHOLD;
    const show3D = footprintVisible && zoom >= ZOOM_3D_THRESHOLD;
    const showHit = hitEnabled && zoom >= 14;

    this._emit('zoomChange', { zoom });

    [FOOTPRINT_FILL, FOOTPRINT_LINE].forEach((id) => {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', show2D ? 'visible' : 'none');
      }
    });

    if (this.map.getLayer(FOOTPRINT_HIT)) {
      this.map.setLayoutProperty(
        FOOTPRINT_HIT,
        'visibility',
        showHit ? 'visible' : 'none',
      );
    }

    if (this.map.getLayer(FOOTPRINT_EXTRUSION)) {
      this.map.setLayoutProperty(
        FOOTPRINT_EXTRUSION,
        'visibility',
        show3D ? 'visible' : 'none',
      );

      if (show3D) {
        const lod2Active = zoom >= ZOOM_LOD2_THRESHOLD && state.lod2Enabled;

        // 初期表示と同じ見た目を維持するため、
        // LOD2 がある建物は footprint 疑似3Dから除外したまま。
        this.map.setFilter(
          FOOTPRINT_EXTRUSION,
          this._buildFootprintExtrusionFilter(lod2Active),
        );
      }
    }

    const hasSelectedFeature =
      Boolean(this.map.getSource(SELECTED_BUILDING_SOURCE)) &&
      Boolean(state.selectedBuildingGeometry);

    if (this.map.getLayer(SELECTED_BUILDING_FILL)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_FILL,
        'visibility',
        hasSelectedFeature && show2D ? 'visible' : 'none',
      );
    }

    if (this.map.getLayer(SELECTED_BUILDING_LINE)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_LINE,
        'visibility',
        hasSelectedFeature && show2D ? 'visible' : 'none',
      );
    }

    if (this.map.getLayer(SELECTED_BUILDING_EXTRUSION)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_EXTRUSION,
        'visibility',
        hasSelectedFeature && zoom >= ZOOM_3D_THRESHOLD ? 'visible' : 'none',
      );
    }

    if (this.lod2Layer) {
      const lod2Active = zoom >= ZOOM_LOD2_THRESHOLD && state.lod2Enabled;

      if (this._lod2Active !== lod2Active) {
        this._lod2Active = lod2Active;
        this.lod2Layer.setVisible(lod2Active);
      }
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────

  setPitch(pitch) {
    if (!this.map) return;

    this.map.easeTo({
      pitch: Math.max(0, Math.min(MAX_PITCH, Number(pitch))),
      duration: 180,
    });
  }

  setLod2HeightScanBandWidth(widthM) {
    this._heightScanBandWidthM = Math.max(0.1, Math.min(0.5, Number(widthM) || 0.1));

    if (this.lod2Layer?.setHeightScanStyle) {
      this.lod2Layer.setHeightScanStyle({
        bandWidthM: this._heightScanBandWidthM,
        scanColor: this._heightScanColor,
      });
    }
  }

  setLod2HeightScanColor(color) {
    if (!color) return;

    this._heightScanColor = color;

    if (this.lod2Layer?.setHeightScanStyle) {
      this.lod2Layer.setHeightScanStyle({
        bandWidthM: this._heightScanBandWidthM,
        scanColor: this._heightScanColor,
      });
    }

    if (this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) {
      this.map.setPaintProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'fill-extrusion-color',
        this._heightScanColor,
      );
    }
  }

  setFootprintVisible(visible) {
    state.footprintEnabled = visible;
    if (!visible && state.activeBuildingLayerMode === 'footprint') {
      this._clearSelection();
    }
    this._onZoom();
  }

  setLod2Visible(visible) {
    state.lod2Enabled = visible;
    if (!visible && state.activeBuildingLayerMode === 'lod2') {
      this._clearSelection();
    }

    if (this.lod2Layer) {
      this.lod2Layer.setVisible(
        visible && this.map.getZoom() >= ZOOM_LOD2_THRESHOLD,
      );
    }

    this._onZoom();
  }

  setTranGlbVisible(visible) {
    state.tranGlbEnabled = visible;

    if (this.tranLayer) {
      this.tranLayer.setVisible(visible);
    }
  }

  setTranVisible(visible) {
    this.setTranGlbVisible(visible);
  }

  setTranGlbColor(color) {
    if (this.tranLayer) {
      this.tranLayer.setColor(color);
    }
  }

  setTranGlbOpacity(opacity) {
    if (this.tranLayer) {
      this.tranLayer.setOpacity(opacity);
    }
  }

  setGsiRoadVisible(visible) {
    if (this.styleTuner) {
      this.styleTuner.setRoadVisible(visible);
    }
  }

  setGsiRoadColor(color) {
    if (this.styleTuner) {
      this.styleTuner.setRoadColor(color);
    }
  }

  setGsiRoadOpacity(opacity) {
    if (this.styleTuner) {
      this.styleTuner.setRoadOpacity(opacity);
    }
  }

  setGlbOriginOffset(dLon, dLat) {
    this._glbDLon = Number(dLon) || 0;
    this._glbDLat = Number(dLat) || 0;

    if (this.tranLayer) {
      this.tranLayer.setOriginOffset(this._glbDLon, this._glbDLat);
    }

    if (this.lod2Layer) {
      this.lod2Layer.setOriginOffset(this._glbDLon, this._glbDLat);
    }
  }

  setLuseGreenVisible(visible) {
    if (this.vegetationManager) {
      this.vegetationManager.setGreenVisible(visible);
    }
  }

  setLuseSchoolyardVisible(visible) {
    if (this.vegetationManager) {
      this.vegetationManager.setSchoolyardVisible(visible);
    }
  }

  setLuseOpacity(opacity) {
    if (this.vegetationManager) {
      this.vegetationManager.setOpacity(opacity);
    }
  }

  setLuseGreenColor(color) {
    if (this.vegetationManager) {
      this.vegetationManager.setGreenColor(color);
    }
  }

  setLuseSchoolColor(color) {
    if (this.vegetationManager) {
      this.vegetationManager.setSchoolColor(color);
    }
  }

  // ── 照明 API（LOD1・LOD2 連動） ───────────────────────────────

  setSunAzimuth(deg) {
    this._sunAzimuth = Number(deg);

    this._applyMapLibreLight();

    if (this.lod2Layer) {
      this.lod2Layer.setLighting({
        azimuth: this._sunAzimuth,
      });
    }
  }

  setSunElevation(deg) {
    this._sunElevation = Number(deg);

    this._applyMapLibreLight();

    if (this.lod2Layer) {
      this.lod2Layer.setLighting({
        elevation: this._sunElevation,
      });
    }
  }

  setSunIntensity(val) {
    this._sunIntensity = Number(val);

    this._applyMapLibreLight();

    if (this.lod2Layer) {
      this.lod2Layer.setLighting({
        sunIntensity: this._sunIntensity,
      });
    }
  }

  setAmbientIntensity(val) {
    this._ambientIntensity = Number(val);

    if (this.lod2Layer) {
      this.lod2Layer.setLighting({
        ambientIntensity: this._ambientIntensity,
      });
    }
  }

  // ── 地面色 ──────────────────────────────────────────────────

  setGroundColor(color) {
    if (!color) return;

    this._groundColor = color;

    if (this.map) {
      this.map.getCanvas().style.background = color;
    }

    if (this.map?.getLayer(BG_LAYER_ID)) {
      try {
        this.map.setPaintProperty(BG_LAYER_ID, 'background-color', color);
      } catch (_) {}
    }

    const style = this.map?.getStyle();

    if (style) {
      for (const layer of style.layers || []) {
        if (layer.type !== 'fill') continue;

        const t = _layerText(layer);

        if (!_looksLikeWater(t) && !_looksLikeVegetation(t) && !_looksLikeBuilding(t)) {
          try {
            this.map.setPaintProperty(layer.id, 'fill-color', color);
            this.map.setPaintProperty(layer.id, 'fill-outline-color', color);
          } catch (_) {}
        }
      }
    }
  }

  // ── Footprint / LOD2 色 API ─────────────────────────────────

  setFootprintFillColor(color) {
    this.footprintStyle.fillColor = color;
    this._applyFootprintStyle();
  }

  setFootprintFillOpacity(opacity) {
    this.footprintStyle.fillOpacity = Number(opacity);
    this._applyFootprintStyle();
  }

  setFootprintLineColor(color) {
    this.footprintStyle.lineColor = color;
    this._applyFootprintStyle();
  }

  setFootprintLineOpacity(opacity) {
    this.footprintStyle.lineOpacity = Number(opacity);
    this._applyFootprintStyle();
  }

  setFootprintLineWidth(width) {
    this.footprintStyle.lineWidth = Number(width);
    this._applyFootprintStyle();
  }

  setLod2RoofColor(color) {
    if (!color) return;

    this.footprintStyle.lod2RoofColor = color;

    if (this.lod2Layer?.setBuildingColor) {
      this.lod2Layer.setBuildingColor(color);
    }
  }

  setLod2WallColor(color) {
    if (!color) return;

    this.footprintStyle.lod2WallColor = color;

    if (this.lod2Layer?.setWallColor) {
      this.lod2Layer.setWallColor(color);
    }
  }

  _footprintFillColorExpr() {
    return this.footprintStyle.fillColor;
  }

  _footprintFillOpacityExpr() {
    return this.footprintStyle.fillOpacity;
  }

  _footprintExtrusionColorExpr() {
    return this.footprintStyle.fillColor;
  }

  _footprintLineColorExpr() {
    return this.footprintStyle.lineColor;
  }

  _footprintLineOpacityExpr() {
    return this.footprintStyle.lineOpacity;
  }

  _footprintLineWidthExpr() {
    return this.footprintStyle.lineWidth;
  }

  _applyFootprintStyle() {
    if (!this.map) return;

    if (this.map.getLayer(FOOTPRINT_FILL)) {
      this.map.setPaintProperty(
        FOOTPRINT_FILL,
        'fill-color',
        this._footprintFillColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_FILL,
        'fill-opacity',
        this._footprintFillOpacityExpr(),
      );
    }

    if (this.map.getLayer(FOOTPRINT_LINE)) {
      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-color',
        this._footprintLineColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-opacity',
        this._footprintLineOpacityExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-width',
        this._footprintLineWidthExpr(),
      );
    }

    if (this.map.getLayer(FOOTPRINT_EXTRUSION)) {
      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION,
        'fill-extrusion-color',
        this._footprintExtrusionColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION,
        'fill-extrusion-opacity',
        this.footprintStyle.fillOpacity,
      );
    }
  }

  // ── 選択 ────────────────────────────────────────────────────

  _attachClickHandlers() {
    if (this._clickHandlersAttached) return;
    this._clickHandlersAttached = true;

    this.map.on('click', (e) => {
      const lod2Pick = this._pickLod2Mesh(e.point);

      if (lod2Pick) {
        this._selectLod2Mesh(lod2Pick, e.lngLat);
        return;
      }

      const layerIds = this._clickableBuildingLayerIds();

      if (!layerIds.length) return;

      const features = this.map.queryRenderedFeatures(e.point, {
        layers: layerIds,
      });

      if (!features?.length) return;

      const feature = features[0];

      this._selectBuilding(feature, e.lngLat);
    });

    this.map.on('mousemove', (e) => {
      const lod2Pick = this._pickLod2Mesh(e.point);

      if (lod2Pick) {
        this.map.getCanvas().style.cursor = 'pointer';
        return;
      }

      const layerIds = this._clickableBuildingLayerIds();

      if (!layerIds.length) {
        this.map.getCanvas().style.cursor = '';
        return;
      }

      const features = this.map.queryRenderedFeatures(e.point, {
        layers: layerIds,
      });

      this.map.getCanvas().style.cursor = features?.length ? 'pointer' : '';
    });

    this.map.on('mouseleave', () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  _clickableBuildingLayerIds() {
    // 選択中の種類でロックしない。
    // 毎クリックで LOD2 hit が無ければ footprint hit を許可する。
    // これにより LOD2 ⇄ footprint 間を自由に移動できる。
    return [
      FOOTPRINT_HIT,
      FOOTPRINT_EXTRUSION,
      FOOTPRINT_FILL,
    ].filter((id) => this.map.getLayer(id));
  }

  _pickLod2Mesh(point) {
    if (!this.lod2Layer?.raycastPick) return null;
    if (!state.lod2Enabled) return null;
    // 選択中の種類でロックしない。
    // 毎クリックで LOD2 側も常に再判定する。
    if (this.map.getZoom() < ZOOM_LOD2_THRESHOLD) return null;

    return this.lod2Layer.raycastPick(point);
  }

  _selectLod2Mesh(pick, lngLat) {
    if (!pick?.mesh) return;

    const center = this.map.getCenter();

    if (!state.previousCameraState) {
      state.previousCameraState = {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch(),
      };
    }

    // LOD2 建物が主選択。表示は変えず、以後は footprint 側の選択だけ止める。
    this._stopSelectedFootprintHeightScan();
    state.activeBuildingLayerMode = 'lod2';
    state.selectedBuildingId = pick.id ?? null;
    state.selectedFootprintMi = null;
    state.selectedBuildingGeometry = null;
    state.selectedBuildingProperties = pick.properties ?? {};

    this._clearSelectedBuildingFeature();

    // 丁全体 highlight は消す。
    if (this.lod2Layer?.clearHighlight) {
      this.lod2Layer.clearHighlight();
    }

    // LOD2 は mesh 命中を起点に、同じ building id の roof / wall / body をまとめて選択表示する。
    if (this.lod2Layer?.highlightBuildingFromPick) {
      this.lod2Layer.highlightBuildingFromPick(pick);
    } else if (this.lod2Layer?.highlightMesh) {
      this.lod2Layer.highlightMesh(pick.mesh);
    }

    state.selectedChomeId = pick.chomeCode ?? null;

    // LOD2 選択では bbox へ寄るが、ユーザーが回転した方位・pitch は維持する。
    // fitBounds() は bearing / pitch を戻しやすいため使わず、cameraForBounds() で
    // center / zoom だけを求め、easeTo() へ現在の bearing / pitch を明示的に渡す。
    const lod2Bbox = this.lod2Layer?.getBuildingLngLatBboxFromPick?.(pick);
    const cameraMoved = this.cameraController?.fitBuildingBboxKeepView(lod2Bbox) ?? false;

    // LOD2 のみレーザースキャンを自動起動する。
    // bbox へ寄った場合は、カメラ移動完了後に開始しないと遠景ではレーザーが見えにくい。
    this._scheduleSelectedLod2HeightScan({
      waitForMoveEnd: cameraMoved,
    });

    this._onZoom();

    this._emit('selectionChange', {
      type: 'lod2_mesh',
      lngLat,
      properties: pick.properties ?? {},
      lod2Pick: pick,
    });
  }

  /**
   * LOD2 建物選択後、カメラ fit が終わってから高さ走査を1回だけ発動する。
   * 選択が変わった場合は古い待機を無効化する。
   */
  _scheduleSelectedLod2HeightScan({ waitForMoveEnd = true } = {}) {
    if (!this.map || !this.lod2Layer?.startSelectedBuildingHeightScan) return;

    const token = ++this._heightScanStartToken;

    const start = () => {
      if (token !== this._heightScanStartToken) return;
      if (state.activeBuildingLayerMode !== 'lod2') return;

      requestAnimationFrame(() => {
        if (token !== this._heightScanStartToken) return;
        if (state.activeBuildingLayerMode !== 'lod2') return;

        this.lod2Layer.startSelectedBuildingHeightScan({
          durationMs: 6000,
          bandWidthM: this._heightScanBandWidthM,
          scanColor: this._heightScanColor,
        });
      });
    };

    if (waitForMoveEnd) {
      this.map.once('moveend', start);
    } else {
      start();
    }
  }

  /**
   * Footprint 疑似3D建物選択後、カメラ fit が終わってから高さ走査を1回だけ発動する。
   */
  _scheduleSelectedFootprintHeightScan({ waitForMoveEnd = true } = {}) {
    if (!this.map || !this.footprintScanLayer) return;
    if (!state.selectedBuildingGeometry) return;

    const token = ++this._footprintHeightScanToken;

    const start = () => {
      if (token !== this._footprintHeightScanToken) return;
      if (state.activeBuildingLayerMode !== 'footprint') return;

      requestAnimationFrame(() => {
        if (token !== this._footprintHeightScanToken) return;
        if (state.activeBuildingLayerMode !== 'footprint') return;

        const properties = state.selectedBuildingProperties ?? {};
        const heightM = this._selectedFootprintHeightMeters(properties);

        this.footprintScanLayer.startFromFeature(
          {
            type: 'Feature',
            geometry: state.selectedBuildingGeometry,
            properties,
          },
          {
            heightMeters: heightM,
            durationMs: 6000,
            bandWidthM: this._heightScanBandWidthM,
            color: this._heightScanColor,
          },
        );
      });
    };

    if (waitForMoveEnd) {
      this.map.once('moveend', start);
    } else {
      start();
    }
  }

  _selectedFootprintHeightMeters(properties = {}) {
    const candidates = [
      properties?.height,
      properties?.measuredHeight,
      properties?.h,
      properties?.HEIGHT,
      properties?.MeasuredHeight,
    ];

    for (const raw of candidates) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }

    return 10;
  }

  _stopSelectedFootprintHeightScan() {
    this._footprintHeightScanToken += 1;

    if (this.footprintScanLayer?.stop) {
      this.footprintScanLayer.stop();
    }

    // 旧 MapLibre fill-extrusion scan layer が残っている版からの移行時だけ安全に隠す。
    if (this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'visibility',
        'none',
      );
    }
  }

  _selectBuilding(feature, lngLat) {
    if (!feature?.geometry) {
      console.warn('[MapApp] clicked feature has no geometry:', feature);
      return;
    }

    const center = this.map.getCenter();

    state.previousCameraState = {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    };

    // Footprint 建物が主選択。表示は変えず、以後は LOD2 側の選択だけ止める。
    state.activeBuildingLayerMode = 'footprint';
    this._heightScanStartToken += 1;

    if (this.lod2Layer?.clearMeshSelection) {
      this.lod2Layer.clearMeshSelection();
    }

    const selectedFeatures = this._collectFootprintBuildingFeatures(feature);
    const mergedFeature = this._mergeFootprintFeatures(selectedFeatures, feature);
    const selectedMi = this._footprintMi(feature);

    state.selectedBuildingId = null;
    state.selectedFootprintMi = selectedMi;
    state.selectedBuildingGeometry = mergedFeature.geometry;
    state.selectedBuildingProperties = feature.properties ?? {};

    this._setSelectedBuildingFeature(mergedFeature);

    // footprint 選択中は LOD2 を使わないため、丁単位 highlight は出さない。
    state.selectedChomeId = null;

    // Footprint 選択でも bbox へ寄るが、ユーザーが回転した方位・pitch は維持する。
    const footprintBbox = this._featuresToBbox(selectedFeatures)
      ?? this._geometryToBbox(mergedFeature.geometry);
    const shouldWaitForCamera = this.cameraController?.fitBuildingBboxKeepView(footprintBbox) ?? false;

    this._scheduleSelectedFootprintHeightScan({ waitForMoveEnd: shouldWaitForCamera });

    this._onZoom();

    this._emit('selectionChange', {
      feature,
      lngLat,
      properties: feature.properties,
    });
  }



  _buildFootprintExtrusionFilter(lod2Active) {
    const filters = [];

    if (lod2Active) {
      filters.push(['!=', ['get', 'l2'], 1]);
    }

    if (state.selectedFootprintMi !== null && state.selectedFootprintMi !== undefined) {
      filters.push(['!=', ['get', 'mi'], state.selectedFootprintMi]);
    }

    if (!filters.length) return null;
    if (filters.length === 1) return filters[0];

    return ['all', ...filters];
  }

  _footprintMi(feature) {
    const raw = feature?.properties?.mi;

    if (raw === null || raw === undefined || raw === '') return null;

    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }

  /**
   * PMTiles / vector tile 化でタイル境界に分かれた footprint を、
   * mi を建物単位キーとして viewer 側で再集合する。
   */
  _collectFootprintBuildingFeatures(clickedFeature) {
    const mi = this._footprintMi(clickedFeature);

    if (mi === null) {
      return [this._plainGeoJsonFeature(clickedFeature)];
    }

    let sourceFeatures = [];

    try {
      sourceFeatures = this.map.querySourceFeatures(FOOTPRINT_SOURCE, {
        sourceLayer: this.footprintSourceLayer,
        filter: ['==', ['get', 'mi'], mi],
      }) ?? [];
    } catch (err) {
      console.warn('[MapApp] querySourceFeatures for footprint mi failed:', mi, err);
    }

    const candidates = sourceFeatures.length
      ? sourceFeatures
      : [clickedFeature];

    const unique = [];
    const seen = new Set();

    for (const f of candidates) {
      if (!f?.geometry) continue;

      const plain = this._plainGeoJsonFeature(f);
      const key = JSON.stringify(plain.geometry);

      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(plain);
    }

    return unique.length
      ? unique
      : [this._plainGeoJsonFeature(clickedFeature)];
  }

  _plainGeoJsonFeature(feature) {
    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ...(feature.properties ?? {}),
      },
    };
  }

  /**
   * 複数 fragment を、選択表示用の 1 feature に戻す。
   * 元データは 1棟 1 feature だが、vector tile ではタイル境界で fragment 化されるため、
   * viewer の選択表示だけ MultiPolygon にまとめ直す。
   */
  _mergeFootprintFeatures(features, fallbackFeature) {
    const list = Array.isArray(features) && features.length
      ? features
      : [this._plainGeoJsonFeature(fallbackFeature)];

    const polygons = [];

    for (const feature of list) {
      const geom = feature?.geometry;
      if (!geom) continue;

      if (geom.type === 'Polygon') {
        polygons.push(geom.coordinates);
      } else if (geom.type === 'MultiPolygon') {
        polygons.push(...geom.coordinates);
      }
    }

    const baseProps = {
      ...(fallbackFeature?.properties ?? list[0]?.properties ?? {}),
    };

    if (!polygons.length) {
      return this._plainGeoJsonFeature(fallbackFeature);
    }

    return {
      type: 'Feature',
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
      properties: baseProps,
    };
  }

  _featuresToBbox(features) {
    if (!Array.isArray(features) || !features.length) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const feature of features) {
      const bbox = this._geometryToBbox(feature?.geometry);
      if (!bbox) continue;

      minLng = Math.min(minLng, bbox[0]);
      minLat = Math.min(minLat, bbox[1]);
      maxLng = Math.max(maxLng, bbox[2]);
      maxLat = Math.max(maxLat, bbox[3]);
    }

    if (
      !Number.isFinite(minLng) ||
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLng) ||
      !Number.isFinite(maxLat)
    ) {
      return null;
    }

    return [minLng, minLat, maxLng, maxLat];
  }

  _setSelectedBuildingFeature(feature) {
    const source = this.map.getSource(SELECTED_BUILDING_SOURCE);

    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...(feature.properties ?? {}),
          },
        },
      ],
    });
  }

  _clearSelectedBuildingFeature() {
    const source = this.map.getSource(SELECTED_BUILDING_SOURCE);

    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: [],
    });
  }

  _geometryToBbox(geometry) {
    if (!geometry) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    const visitCoord = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return;

      const lng = Number(coord[0]);
      const lat = Number(coord[1]);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    };

    const walk = (coords) => {
      if (!Array.isArray(coords)) return;

      if (
        coords.length >= 2 &&
        typeof coords[0] === 'number' &&
        typeof coords[1] === 'number'
      ) {
        visitCoord(coords);
        return;
      }

      for (const c of coords) {
        walk(c);
      }
    };

    walk(geometry.coordinates);

    if (
      !Number.isFinite(minLng) ||
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLng) ||
      !Number.isFinite(maxLat)
    ) {
      return null;
    }

    return [minLng, minLat, maxLng, maxLat];
  }

  goBack() {
    if (!state.previousCameraState) return;

    const prev = state.previousCameraState;

    this.map.easeTo({
      center: prev.center,
      zoom: prev.zoom,
      bearing: prev.bearing,
      pitch: prev.pitch,
      duration: 600,
    });

    this._clearSelection();

    state.previousCameraState = null;

    this._emit('selectionChange', null);
  }

  _clearSelection() {
    this._heightScanStartToken += 1;
    this._stopSelectedFootprintHeightScan();

    state.activeBuildingLayerMode = null;
    state.selectedBuildingId = null;
    state.selectedFootprintMi = null;
    state.selectedBuildingGeometry = null;
    state.selectedBuildingProperties = null;

    this._clearSelectedBuildingFeature();

    if (this.lod2Layer?.clearMeshSelection) {
      this.lod2Layer.clearMeshSelection();
    }

    if (state.selectedChomeId && this.lod2Layer) {
      this.lod2Layer.clearHighlight();
      state.selectedChomeId = null;
    }

    this._onZoom();
  }

  _findChomeAtLngLat(lng, lat) {
    if (this.lod2Layer?.findChomeAtLngLat) {
      return this.lod2Layer.findChomeAtLngLat(lng, lat);
    }

    for (const entry of this.lod2Layer?._chomeIndex ?? []) {
      const [w, s, e, n] = entry.bbox;

      if (lng >= w && lng <= e && lat >= s && lat <= n) {
        return entry.chome_code;
      }
    }

    return null;
  }

  // ── Event emitter ───────────────────────────────────────────

  on(event, handler) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }

    this._listeners[event].push(handler);

    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach((h) => h(data));
  }
}
