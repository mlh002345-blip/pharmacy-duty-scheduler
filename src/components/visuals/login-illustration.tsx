// Giriş ekranındaki izometrik "şehir + nöbet haritası" illüstrasyonu.
// Harici görsel/3D kütüphane kullanılmaz; tamamen statik SVG'dir.
export function LoginIllustration() {
  return (
    <svg
      viewBox="0 0 560 480"
      role="img"
      aria-label="Şehir haritası üzerinde nöbetçi eczane noktaları ve nöbet takvimi illüstrasyonu"
      className="h-auto w-full max-w-lg drop-shadow-2xl"
    >
      <defs>
        <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0fdf6" />
          <stop offset="100%" stopColor="#d8efe3" />
        </linearGradient>
        <linearGradient id="plateSide" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b9d9c9" />
          <stop offset="100%" stopColor="#93bfa9" />
        </linearGradient>
        <linearGradient id="buildingFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e9f5ee" />
        </linearGradient>
        <linearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id="calHeader" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#047857" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      {/* Zemin plakası (izometrik) */}
      <g>
        <polygon points="280,64 536,208 280,352 24,208" fill="url(#plate)" />
        <polygon points="24,208 280,352 280,376 24,232" fill="url(#plateSide)" />
        <polygon points="536,208 280,352 280,376 536,232" fill="#7fae97" />

        {/* İzometrik cadde ızgarası */}
        <g stroke="#ffffff" strokeWidth="10" strokeLinecap="round" opacity="0.85">
          <line x1="152" y1="136" x2="408" y2="280" />
          <line x1="408" y1="136" x2="152" y2="280" />
        </g>
        <g stroke="#c2ddd0" strokeWidth="1.5" opacity="0.8">
          <line x1="88" y1="172" x2="344" y2="316" />
          <line x1="216" y1="100" x2="472" y2="244" />
          <line x1="472" y1="172" x2="216" y2="316" />
          <line x1="344" y1="100" x2="88" y2="244" />
        </g>

        {/* Yol çizgisi (rota) */}
        <path
          d="M 168 232 Q 240 196 280 208 T 396 196"
          fill="none"
          stroke="#0f766e"
          strokeWidth="2.5"
          strokeDasharray="6 6"
          opacity="0.7"
        />

        {/* Küçük park alanları */}
        <polygon points="140,180 176,200 140,220 104,200" fill="#a7d4bd" opacity="0.9" />
        <polygon points="420,236 452,254 420,272 388,254" fill="#a7d4bd" opacity="0.9" />
      </g>

      {/* Eczane binası (izometrik küp) */}
      <g>
        {/* Gölge */}
        <ellipse cx="282" cy="270" rx="66" ry="18" fill="#1e3a34" opacity="0.14" />
        {/* Gövde */}
        <polygon points="232,158 282,186 282,258 232,230" fill="url(#buildingFront)" />
        <polygon points="332,158 282,186 282,258 332,230" fill="#d3e8dc" />
        <polygon points="282,130 332,158 282,186 232,158" fill="#ffffff" />
        {/* Ön yüz: yeşil eczane haçı */}
        <g transform="translate(250,196)">
          <rect x="-8" y="-8" width="16" height="40" rx="3" fill="#059669" transform="skewY(29)" />
          <rect x="-20" y="4" width="40" height="16" rx="3" fill="#059669" transform="skewY(29)" />
        </g>
        {/* Yan yüz: kapı ve pencere */}
        <polygon points="296,206 316,196 316,240 296,250" fill="#4b6e60" opacity="0.85" />
        <polygon points="296,178 316,168 316,184 296,194" fill="#9fc6b2" />
        {/* Tabela */}
        <polygon points="236,150 282,176 328,150 282,124" fill="none" />
        <g transform="translate(282,116)">
          <rect x="-38" y="-14" width="76" height="22" rx="11" fill="#065f46" />
          <text
            x="0"
            y="1"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="700"
            fill="#ffffff"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            ECZANE
          </text>
        </g>
      </g>

      {/* Konum pinleri */}
      {[
        { x: 168, y: 232, delay: "0s" },
        { x: 396, y: 196, delay: "0.8s" },
        { x: 348, y: 292, delay: "1.6s" },
      ].map((pin) => (
        <g key={`${pin.x}-${pin.y}`}>
          <ellipse
            cx={pin.x}
            cy={pin.y + 4}
            rx="14"
            ry="6"
            fill="#059669"
            className="duty-pin-pulse"
            style={{ animationDelay: pin.delay }}
          />
          <path
            d={`M ${pin.x} ${pin.y} c -11 -14 -11 -26 0 -34 c 11 8 11 20 0 34 z`}
            fill="url(#pinGrad)"
            transform={`translate(0,-6)`}
          />
          <circle cx={pin.x} cy={pin.y - 26} r="5.5" fill="#ffffff" />
        </g>
      ))}

      {/* Yüzen nöbet takvimi kartı */}
      <g transform="translate(392,54) rotate(6)">
        <rect x="0" y="0" width="128" height="112" rx="14" fill="#ffffff" stroke="#dbeee4" />
        <rect x="0" y="0" width="128" height="30" rx="14" fill="url(#calHeader)" />
        <rect x="0" y="16" width="128" height="14" fill="url(#calHeader)" />
        <text
          x="64"
          y="16"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          NÖBET TAKVİMİ
        </text>
        {Array.from({ length: 3 }).map((_, row) =>
          Array.from({ length: 5 }).map((_, col) => {
            const highlighted = row === 1 && col === 2;
            return (
              <rect
                key={`${row}-${col}`}
                x={14 + col * 21}
                y={42 + row * 21}
                width="15"
                height="15"
                rx="4"
                fill={highlighted ? "#059669" : "#eaf4ee"}
                stroke={highlighted ? "none" : "#d8ebe0"}
              />
            );
          })
        )}
      </g>

      {/* Yüzen "bugünün nöbetçisi" rozeti */}
      <g transform="translate(52,86) rotate(-5)">
        <rect x="0" y="0" width="150" height="52" rx="12" fill="#ffffff" stroke="#dbeee4" />
        <circle cx="24" cy="26" r="11" fill="#ecfdf5" stroke="#a7f3d0" />
        <path d="M 24 20 v 12 M 18 26 h 12" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" />
        <text
          x="44"
          y="21"
          fontSize="10"
          fontWeight="700"
          fill="#0f172a"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          Bugünün Nöbetçisi
        </text>
        <rect x="44" y="29" width="76" height="6" rx="3" fill="#e2e8f0" />
        <rect x="44" y="39" width="52" height="6" rx="3" fill="#eef2f6" />
      </g>
    </svg>
  );
}
