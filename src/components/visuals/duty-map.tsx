import { ExternalLink } from "lucide-react";

// Nöbet Haritası: gerçek koordinat verisi gerektirmeyen, stilize edilmiş bir
// SVG harita paneli. Pinler liste sırasına göre önceden belirlenmiş
// noktalara yerleştirilir; kartlardaki numaralarla eşleşir. Gerçek navigasyon
// için eczanenin mevcut mapUrl alanı kullanılır ("Haritada Aç").
// Harici harita sağlayıcısı veya API anahtarı kullanılmaz.

export type DutyMapPharmacy = {
  id: string;
  name: string;
  mapUrl: string | null;
};

// Pinlerin harita paneli üzerindeki sabit konumları (viewBox yüzdesi değil,
// 600x340 koordinatları). En fazla 6 pin gösterilir.
const PIN_POSITIONS = [
  { x: 200, y: 150 },
  { x: 400, y: 120 },
  { x: 310, y: 230 },
  { x: 130, y: 250 },
  { x: 470, y: 240 },
  { x: 300, y: 90 },
];

export function DutyMap({ pharmacies }: { pharmacies: DutyMapPharmacy[] }) {
  const pins = pharmacies.slice(0, PIN_POSITIONS.length);
  if (pins.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div>
          <p className="text-sm font-semibold">Nöbet Haritası</p>
          <p className="text-muted-foreground text-xs">Bugünün Nöbet Noktaları</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          {pins.length} nöbetçi eczane
        </span>
      </div>

      <svg
        viewBox="0 0 600 340"
        role="img"
        aria-label="Bugünün nöbetçi eczanelerini gösteren temsili harita"
        className="block h-auto w-full"
      >
        <defs>
          <linearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f2faf5" />
            <stop offset="100%" stopColor="#e2f1e8" />
          </linearGradient>
          <linearGradient id="mapPin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>
        </defs>

        <rect width="600" height="340" fill="url(#mapBg)" />

        {/* Su / nehir */}
        <path
          d="M -20 300 C 120 260 180 320 320 290 S 560 320 620 280 L 620 360 L -20 360 Z"
          fill="#cfe6f4"
        />

        {/* Yollar */}
        <g stroke="#ffffff" strokeLinecap="round" fill="none">
          <path d="M -10 180 C 120 150 250 210 380 170 S 560 120 610 140" strokeWidth="14" />
          <path d="M 150 -10 C 170 90 120 200 190 330" strokeWidth="10" />
          <path d="M 420 -10 C 400 100 470 200 430 340" strokeWidth="10" />
          <path d="M -10 90 C 150 110 300 60 610 100" strokeWidth="7" />
        </g>
        <g stroke="#dcebe2" strokeWidth="1.5" fill="none">
          <path d="M -10 180 C 120 150 250 210 380 170 S 560 120 610 140" strokeDasharray="8 10" />
        </g>

        {/* Yeşil alanlar */}
        <ellipse cx="90" cy="70" rx="52" ry="30" fill="#bfe0cd" opacity="0.8" />
        <ellipse cx="520" cy="60" rx="46" ry="26" fill="#bfe0cd" opacity="0.8" />
        <ellipse cx="250" cy="290" rx="40" ry="20" fill="#bfe0cd" opacity="0.6" />

        {/* Bina blokları */}
        <g fill="#d8e8dd">
          <rect x="240" y="120" width="26" height="18" rx="3" />
          <rect x="272" y="132" width="20" height="26" rx="3" />
          <rect x="330" y="200" width="28" height="20" rx="3" />
          <rect x="90" y="200" width="22" height="16" rx="3" />
          <rect x="360" y="70" width="24" height="18" rx="3" />
          <rect x="500" y="180" width="24" height="18" rx="3" />
          <rect x="180" y="60" width="20" height="16" rx="3" />
        </g>

        {/* Pinler */}
        {pins.map((pharmacy, index) => {
          const pos = PIN_POSITIONS[index];
          const pin = (
            <g>
              <title>{pharmacy.name}</title>
              <ellipse
                cx={pos.x}
                cy={pos.y + 3}
                rx="12"
                ry="5"
                fill="#059669"
                className="duty-pin-pulse"
                style={{ animationDelay: `${index * 0.5}s` }}
              />
              <path
                d={`M ${pos.x} ${pos.y} c -13 -16 -13 -30 0 -39 c 13 9 13 23 0 39 z`}
                fill="url(#mapPin)"
                stroke="#ffffff"
                strokeWidth="2"
              />
              <circle cx={pos.x} cy={pos.y - 28} r="9" fill="#ffffff" />
              <text
                x={pos.x}
                y={pos.y - 27.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="700"
                fill="#047857"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {index + 1}
              </text>
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
      </svg>

      <div className="text-muted-foreground flex items-center gap-1.5 border-t px-4 py-2.5 text-xs sm:px-5">
        <ExternalLink className="size-3.5 shrink-0" />
        Temsili haritadır; gerçek konum için eczane kartındaki &quot;Yol Tarifi Al&quot;
        bağlantısını kullanın.
      </div>
    </div>
  );
}
