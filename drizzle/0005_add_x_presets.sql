WITH "candidate_presets" (
	"id",
	"key",
	"name",
	"output_type",
	"defaults",
	"supported_macros",
	"required_fields",
	"docs_url"
) AS (
	VALUES
		(
			'pre_01M28ZTW8XY9GXCCHH2SDH5ZWM',
			'x_organic',
			'X (Twitter) — Organic',
			'url',
			'{"utm_medium":"organic","utm_source":"twitter-organic"}'::jsonb,
			'[]'::jsonb,
			'[]'::jsonb,
			NULL
		),
		(
			'pre_01M28ZTW906ZRETE2WZ9K1ZT1P',
			'x_paid',
			'X (Twitter) Ads',
			'url',
			'{"utm_medium":"paid","utm_source":"twitter-paid"}'::jsonb,
			'[]'::jsonb,
			'["utm_content"]'::jsonb,
			'https://business.x.com/en/help/campaign-measurement-and-analytics'
		)
),
"inserted" AS (
	INSERT INTO "platform_presets" (
		"id",
		"key",
		"name",
		"output_type",
		"defaults",
		"supported_macros",
		"required_fields",
		"static_params",
		"validation_rules",
		"verification_state",
		"docs_url"
	)
	SELECT
		"id",
		"key",
		"name",
		"output_type",
		"defaults",
		"supported_macros",
		"required_fields",
		'{}'::jsonb,
		'{}'::jsonb,
		'draft',
		"docs_url"
	FROM "candidate_presets"
	WHERE EXISTS (SELECT 1 FROM "config_versions" WHERE "id" = 1)
	ON CONFLICT ("key") DO NOTHING
	RETURNING *
),
"bumped" AS (
	UPDATE "config_versions"
	SET "version" = "version" + 1, "updated_at" = now()
	WHERE "id" = 1 AND EXISTS (SELECT 1 FROM "inserted")
	RETURNING "version"
)
INSERT INTO "audit_events" (
	"id",
	"actor_id",
	"actor_email",
	"action",
	"entity_type",
	"entity_id",
	"after",
	"reason",
	"config_version",
	"context"
)
SELECT
	CASE "inserted"."key"
		WHEN 'x_organic' THEN 'rpa_01M28ZVN5S41BFX6ZR4R0KSV4X'
		ELSE 'rpa_01M28ZVN5VNGV8WTWZCH5A7WDT'
	END,
	'system',
	'system@runpod.io',
	'preset.created',
	'platform_preset',
	"inserted"."id",
	to_jsonb("inserted"),
	'Add separate X organic and paid presets while preserving historical twitter-* canonical sources.',
	"bumped"."version",
	'{"source":"migration","migration":"0005_add_x_presets"}'::jsonb
FROM "inserted"
CROSS JOIN "bumped";
