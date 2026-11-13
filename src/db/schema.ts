import {
  pgTable, serial, text, integer, bigint, boolean, timestamp, doublePrecision, jsonb, index,
} from "drizzle-orm/pg-core";

export const albums = pgTable("albums", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("device"), // device | user
  hint: text("hint").notNull().default("other"), // camera, screenshots, screenrec, downloads, wa-images, wa-video, telegram, bluetooth, other
  path: text("path"), // identified source folder path, e.g. DCIM/Camera
  isCamera: boolean("is_camera").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  pinOrder: integer("pin_order").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  coverMediaId: integer("cover_media_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const media = pgTable(
  "media",
  {
    id: serial("id").primaryKey(),
    albumId: integer("album_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    format: text("format").notNull(), // jpg, png, avif ...
    kind: text("kind").notNull(), // image | video
    size: bigint("size", { mode: "number" }).notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    previewWidth: integer("preview_width").notNull().default(0),
    previewHeight: integer("preview_height").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    animated: boolean("animated").notNull().default(false),
    storageKey: text("storage_key").notNull(),
    hasPreview: boolean("has_preview").notNull().default(false),
    sha1: text("sha1").notNull().default(""),
    phash: text("phash").notNull().default(""),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    favorite: boolean("favorite").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    vaulted: boolean("vaulted").notNull().default(false),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    trashAlbumId: integer("trash_album_id"),
    trashAlbumName: text("trash_album_name"),
    customOrder: integer("custom_order").notNull().default(0),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    place: text("place"),
    camera: text("camera"),
    exif: jsonb("exif"),
    sourcePath: text("source_path"),
  },
  (t) => [
    index("media_album_idx").on(t.albumId),
    index("media_taken_idx").on(t.takenAt),
    index("media_sha_idx").on(t.sha1),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const vault = pgTable("vault", {
  id: integer("id").primaryKey(),
  authType: text("auth_type").notNull(), // pin | password
  salt: text("salt").notNull(),
  wrappedKey: text("wrapped_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
