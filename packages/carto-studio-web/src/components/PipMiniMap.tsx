import type { MapSnapshot } from "@historical-cartography/shared-schema";

export interface PipMiniMapProps {
  label: string;
  snapshot: MapSnapshot;
  polityColors: Record<string, string>;
  mainCamera: { center: [number, number]; zoom: number };
  insetFocus?: { center?: [number, number]; zoom?: number } | undefined;
  themeVariant: "atlas_sea_inset" | "tactical_radar";
}

export function PipMiniMap(props: PipMiniMapProps) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feat of props.snapshot.territories.features) {
    for (const pt of feat.geometry.coordinates[0] ?? []) {
      const lon = pt[0] ?? 0;
      const lat = pt[1] ?? 0;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (!Number.isFinite(minLon)) {
    minLon = 40;
    maxLon = 130;
    minLat = 10;
    maxLat = 55;
  }

  const focusCenter = props.insetFocus?.center ?? props.mainCamera.center;
  const focusSpan = props.insetFocus?.zoom ? 28 / Math.max(1.5, props.insetFocus.zoom) : 14;
  minLon = Math.min(minLon, focusCenter[0] - focusSpan) - 2;
  maxLon = Math.max(maxLon, focusCenter[0] + focusSpan) + 2;
  minLat = Math.min(minLat, focusCenter[1] - focusSpan * 0.6) - 2;
  maxLat = Math.max(maxLat, focusCenter[1] + focusSpan * 0.6) + 2;

  const lonSpan = Math.max(8, maxLon - minLon);
  const latSpan = Math.max(6, maxLat - minLat);
  const toSvg = (lon: number, lat: number): [number, number] => [
    ((lon - minLon) / lonSpan) * 200,
    112 - ((lat - minLat) / latSpan) * 112,
  ];

  const [vx1, vy1] = toSvg(
    props.mainCamera.center[0] - 18 / Math.max(1.8, props.mainCamera.zoom),
    props.mainCamera.center[1] + 11 / Math.max(1.8, props.mainCamera.zoom),
  );
  const [vx2, vy2] = toSvg(
    props.mainCamera.center[0] + 18 / Math.max(1.8, props.mainCamera.zoom),
    props.mainCamera.center[1] - 11 / Math.max(1.8, props.mainCamera.zoom),
  );

  const isAtlas = props.themeVariant === "atlas_sea_inset";

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 54 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 6px",
          color: isAtlas ? "#1e293b" : "#38bdf8",
          background: isAtlas ? "rgba(248, 250, 252, 0.92)" : "rgba(15, 23, 42, 0.88)",
          borderBottom: isAtlas ? "1px solid #cbd5e1" : "1px solid rgba(56,189,248,0.28)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{props.label}</span>
        <span style={{ opacity: 0.72, flexShrink: 0 }}>z={props.mainCamera.zoom.toFixed(1)}</span>
      </div>
      <svg
        viewBox="0 0 200 112"
        style={{
          width: "100%",
          flex: 1,
          background: isAtlas ? "#bcd6f0" : "#0b1322",
          display: "block",
        }}
      >
        {props.snapshot.territories.features.map((feat) => {
          const pts = (feat.geometry.coordinates[0] ?? [])
            .map((pt) => toSvg(pt[0] ?? 0, pt[1] ?? 0))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(" ");
          const pid = feat.properties.polity_id ?? feat.properties.face_id;
          return (
            <polygon
              key={`pip-${feat.properties.face_id}`}
              points={pts}
              fill={props.polityColors[pid] ?? "#22c55e"}
              fillOpacity={0.85}
              stroke={isAtlas ? "#475569" : "#e2e8f0"}
              strokeWidth="0.6"
            />
          );
        })}
        <rect
          x={Math.max(1, Math.min(185, Math.min(vx1, vx2)))}
          y={Math.max(1, Math.min(98, Math.min(vy1, vy2)))}
          width={Math.max(10, Math.abs(vx2 - vx1))}
          height={Math.max(8, Math.abs(vy2 - vy1))}
          fill="rgba(239, 68, 68, 0.14)"
          stroke="#ef4444"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
