// Sunucu ortam değişkenlerinin başlangıçta (modül yüklenirken) doğrulanması.
// Bu olmadan, DATABASE_URL eksik/bozuk olsa bile uygulama sorunsuz açılır ve
// yalnızca veritabanına dokunan ilk istekte (gecikmeli olarak) hata verirdi.
// Doğrulama, Prisma istemcisi ilk oluşturulurken (src/lib/prisma.ts bu modülü
// içe aktarır) çalışır ve hata mesajları hiçbir gizli değeri içermez.

const VALID_NODE_ENVS = ["development", "test", "production"] as const;

export type NodeEnv = (typeof VALID_NODE_ENVS)[number];

export type ValidatedEnv = {
  nodeEnv: NodeEnv;
  databaseUrl: string | undefined;
};

export function validateEnv(
  source: Record<string, string | undefined> = process.env
): ValidatedEnv {
  // Next.js NODE_ENV'i her zaman kendisi atar (dev → development,
  // build/start → production); vitest "test" atar. Atanmamışsa yerel
  // araç/betik çalıştırması demektir — development varsayılır.
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!(VALID_NODE_ENVS as readonly string[]).includes(nodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV: expected one of ${VALID_NODE_ENVS.join(", ")}.`
    );
  }

  const databaseUrl = source.DATABASE_URL;

  // Test ortamında Prisma her testte mock'lanır ve gerçek bir bağlantı
  // hiçbir zaman açılmaz; vitest .env dosyalarını da yüklemez. Bu yüzden
  // DATABASE_URL yalnızca test dışındaki ortamlarda zorunludur — gerçek
  // sunucu (development/production) eksik yapılandırmayla AÇILMAZ.
  if (nodeEnv !== "test") {
    if (!databaseUrl) {
      throw new Error("Missing required environment variable: DATABASE_URL");
    }
    if (nodeEnv === "production" && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
      // Üretimde SQLite/file: tarzı bir URL, bayat bir yerel yapılandırmanın
      // yanlışlıkla canlıya taşındığı anlamına gelir — açık biçimde reddedilir.
      // Mesaj bilinçli olarak URL'nin kendisini içermez (kimlik bilgisi sızmasın).
      throw new Error(
        "Invalid DATABASE_URL for production: expected a PostgreSQL connection string."
      );
    }
  }

  return { nodeEnv: nodeEnv as NodeEnv, databaseUrl };
}

export const env = validateEnv();
