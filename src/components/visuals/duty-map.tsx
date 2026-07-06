import { ExternalLink, MapPin } from "lucide-react";

// Nöbet Haritası: gerçek koordinat verisi gerektirmeyen, stilize edilmiş bir
// SVG harita paneli. Pinler liste sırasına göre önceden belirlenmiş
// noktalara yerleştirilir ve kartlardaki numaralarla eşleşir; ilk (bugünün
// birinci) eczanesi vurgulu pin + isim balonu ile gösterilir. Gerçek
// navigasyon için eczanenin mapUrl alanı kullanılır ("Haritada Aç").
// Harici harita sağlayıcısı, API anahtarı veya uzak görsel kullanılmaz.

export type DutyMapPharmacy = {
  id: string;
  name: string;
  mapUrl: string | null;
};

// Pinlerin harita paneli üzerindeki sabit konumları (600x400 koordinatları).
// En fazla 6 pin gösterilir; ilk konum vurgulu pin içindir.
const PIN_POSITIONS = [
  { x: 250, y: 195 },
  { x: 430, y: 130 },
  { x: 340, y: 285 },
  { x: 130, y: 290 },
  { x: 500, y: 265 },
  { x: 150, y: 110 },
];

function truncateName(name: string, max = 20): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

// Basit 2.5D bina bloğu: koyu taban + açık üst yüz.
function Building({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y + 3} width={w} height={h} rx="3" fill="#b9d2c2" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill="#dcebe1" />
    </g>
  );
}

export function DutyMap({ pharmacies }: { pharmacies: DutyMapPharmacy[] }) {
  const pins = pharmacies.slice(0, PIN_POSITIONS.length);
  if (pins.length === 0) return null;

  const featured = pins[0];
  const featuredPos = PIN_POSITIONS[0];
  const routePoints = pins.map((_, i) => PIN_POSITIONS[i]);
  const routePath =
    routePoints.length > 1
      ? routePoints
          .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
          .join(" ")
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
            <MapPin className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Nöbet Haritası</p>
            <p className="text-muted-foreground text-xs">Bugünün Nöbet Noktaları</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          {pins.length} nöbetçi
        </span>
      </div>

      <svg
        viewBox="0 0 600 400"
        role="img"
        aria-label="Bugünün nöbetçi eczanelerini gösteren temsili harita"
        className="block h-auto w-full"
      >
        <defs>
          <linearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f4fbf6" />
            <stop offset="100%" stopColor="#dfeee5" />
          </linearGradient>
          <linearGradient id="mapPin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>
          <linearGradient id="mapPinFeatured" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#065f46" />
          </linearGradient>
          <filter id="pinShadow" x="-40%" y="-20%" width="180%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#134e3a" floodOpacity="0.35" />
          </filter>
          <filter id="bubbleShadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f2e24" floodOpacity="0.25" />
          </filter>
        </defs>

        <rect width="600" height="400" fill="url(#mapBg)" />

        {/* Su / nehir */}
        <path
          d="M -20 352 C 120 310 190 372 330 340 S 570 372 620 330 L 620 420 L -20 420 Z"
          fill="#cfe6f4"
        />
        <path
          d="M -20 360 C 120 318 190 380 330 348 S 570 380 620 338"
          fill="none"
          stroke="#bcd9ec"
          strokeWidth="3"
          opacity="0.7"
        />

        {/* Ana yollar */}
        <g stroke="#ffffff" strokeLinecap="round" fill="none">
          <path d="M -10 210 C 130 175 260 245 390 200 S 570 145 610 165" strokeWidth="17" />
          <path d="M 175 -10 C 195 105 145 235 215 390" strokeWidth="12" />
          <path d="M 455 -10 C 435 115 505 235 465 400" strokeWidth="12" />
          <path d="M -10 105 C 160 128 320 70 610 115" strokeWidth="8" />
          <path d="M -10 300 C 150 285 260 320 400 300" strokeWidth="8" />
        </g>
        {/* Ana caddenin şerit çizgisi */}
        <path
          d="M -10 210 C 130 175 260 245 390 200 S 570 145 610 165"
          fill="none"
          stroke="#d7e8dc"
          strokeWidth="2"
          strokeDasharray="10 12"
        />

        {/* Yeşil alanlar */}
        <ellipse cx="95" cy="70" rx="58" ry="32" fill="#bfe0cd" opacity="0.9" />
        <ellipse cx="95" cy="70" rx="34" ry="18" fill="#aed6bf" opacity="0.9" />
        <ellipse cx="530" cy="60" rx="50" ry="28" fill="#bfe0cd" opacity="0.9" />
        <ellipse cx="280" cy="345" rx="42" ry="18" fill="#bfe0cd" opacity="0.6" />

        {/* Bina blokları (hafif 2.5D) */}
        <Building x={255} y={130} w={30} h={22} />
        <Building x={295} y={148} w={22} h={30} />
        <Building x={360} y={235} w={32} h={22} />
        <Building x={95} y={225} w={26} h={18} />
        <Building x={385} y={75} w={26} h={20} />
        <Building x={520} y={205} w={26} h={20} />
        <Building x={200} y={65} w={22} h={18} />
        <Building x={310} y={80} w={20} h={16} />
        <Building x={70} y={160} w={24} h={18} />
        <Building x={540} y={310} w={24} h={16} />

        {/* Nöbet rotası: pinleri birbirine bağlayan kesikli yol */}
        {routePath && (
          <path
            d={routePath}
            fill="none"
            stroke="#0f766e"
            strokeWidth="2.5"
            strokeDasharray="2 8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.65"
          />
        )}

        {/* Pinler (vurgulu ilk pin en üstte çizilsin diye ters sırada) */}
        {pins
          .map((pharmacy, index) => ({ pharmacy, index }))
          .reverse()
          .map(({ pharmacy, index }) => {
            const pos = PIN_POSITIONS[index];
            const isFeatured = index === 0;
            const scale = isFeatured ? 1.35 : 1;
            const pin = (
              <g>
                <title>{pharmacy.name}</title>
                <ellipse
                  cx={pos.x}
                  cy={pos.y + 4}
                  rx={isFeatured ? 16 : 12}
                  ry={isFeatured ? 7 : 5}
                  fill="#059669"
                  className="duty-pin-pulse"
                  style={{ animationDelay: `${index * 0.5}s` }}
                />
                <g filter="url(#pinShadow)">
                  <path
                    d={`M ${pos.x} ${pos.y} c ${-14 * scale} ${-17 * scale} ${-14 * scale} ${-32 * scale} 0 ${-42 * scale} c ${14 * scale} ${10 * scale} ${14 * scale} ${25 * scale} 0 ${42 * scale} z`}
                    fill={isFeatured ? "url(#mapPinFeatured)" : "url(#mapPin)"}
                    stroke="#ffffff"
                    strokeWidth={isFeatured ? 3 : 2}
                  />
                  <circle
                    cx={pos.x}
                    cy={pos.y - 30 * scale}
                    r={10 * scale}
                    fill="#ffffff"
                  />
                  <text
                    x={pos.x}
                    y={pos.y - 30 * scale + 0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={isFeatured ? 14 : 12}
                    fontWeight="700"
                    fill="#047857"
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                  >
                    {index + 1}
                  </text>
                </g>
              </g>
            );

            return pharmacy.mapUrl ? (
              <a
                key={pharmacy.id}
                href={pharmacy.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${pharmacy.name} — Haritada Aç`}
              >
                {pin}
              </a>
            ) : (
              <g key={pharmacy.id}>{pin}</g>
            );
          })}

        {/* Vurgulu eczane için isim balonu */}
        <g filter="url(#bubbleShadow)">
          <g
            transform={`translate(${Math.min(Math.max(featuredPos.x, 120), 440)}, ${featuredPos.y - 96})`}
          >
            <rect x="-105" y="-24" width="210" height="42" rx="12" fill="#083c30" />
            <path d="M -8 18 L 0 30 L 8 18 Z" fill="#083c30" />
            <text
              x="0"
              y="-8"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="10"
              fontWeight="600"
              fill="#6ee7b7"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              BUGÜN NÖBETÇİ
            </text>
            <text
              x="0"
              y="7"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="13"
              fontWeight="700"
              fill="#ffffff"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {truncateName(featured.name)}
            </text>
          </g>
        </g>
      </svg>

      <div className="text-muted-foreground flex items-center gap-1.5 border-t px-4 py-2.5 text-xs sm:px-5">
        <ExternalLink className="size-3.5 shrink-0" />
        Temsili haritadır; pinlere tıklayarak eczaneyi haritada açabilirsiniz.
      </div>
    </div>
  );
}
