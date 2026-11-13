const fs = require("fs");
const path = require("path");

const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = fs.readFileSync(manifestPath, "utf8");

if (!manifest.includes("READ_MEDIA_IMAGES")) {
  manifest = manifest.replace(
    "<application",
    `<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />

    <application android:requestLegacyExternalStorage="true"`
  );
  fs.writeFileSync(manifestPath, manifest);
}

const javaDir = path.join("android/app/src/main/java/com/prism/gallery");
fs.mkdirSync(javaDir, { recursive: true });

fs.writeFileSync(
  path.join(javaDir, "PrismStoragePlugin.java"),
  `package com.prism.gallery;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Size;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "PrismStorage",
    permissions = {
        @Permission(
            strings = {
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO",
                "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
            },
            alias = "media14"
        ),
        @Permission(
            strings = {
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO"
            },
            alias = "media13"
        ),
        @Permission(
            strings = {
                "android.permission.READ_EXTERNAL_STORAGE"
            },
            alias = "legacy"
        )
    }
)
public class PrismStoragePlugin extends Plugin {

    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    private boolean isGranted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasMediaReadPermission() {
        if (Build.VERSION.SDK_INT >= 34) {
            return (isGranted("android.permission.READ_MEDIA_IMAGES")
                    && isGranted("android.permission.READ_MEDIA_VIDEO"))
                || isGranted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return isGranted("android.permission.READ_MEDIA_IMAGES")
                && isGranted("android.permission.READ_MEDIA_VIDEO");
        }
        return isGranted("android.permission.READ_EXTERNAL_STORAGE");
    }

    private boolean hasAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return hasMediaReadPermission();
    }

    private JSObject buildStatus() {
        JSObject ret = new JSObject();
        ret.put("mediaGranted", hasMediaReadPermission());
        ret.put("allFilesGranted", hasAllFilesAccess());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    private long getIdArg(PluginCall call) {
        Object raw = call.getData().opt("id");
        return raw instanceof Number ? ((Number) raw).longValue() : 0L;
    }

    @PluginMethod
    public void checkStorage(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestStorage(PluginCall call) {
        if (hasMediaReadPermission()) {
            call.resolve(buildStatus());
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            requestPermissionForAlias("media14", call, "storagePermsCallback");
        } else if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAlias("media13", call, "storagePermsCallback");
        } else {
            requestPermissionForAlias("legacy", call, "storagePermsCallback");
        }
    }

    @PermissionCallback
    private void storagePermsCallback(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void openAllFilesAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception e) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                getActivity().startActivity(intent);
            }
        } else {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve(buildStatus());
    }

    private static String toIso(long millis) {
        if (millis <= 0) millis = System.currentTimeMillis();
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    private static long getLong(Cursor c, String col) {
        int idx = c.getColumnIndex(col);
        return idx >= 0 && !c.isNull(idx) ? c.getLong(idx) : 0L;
    }

    private static int getInt(Cursor c, String col) {
        int idx = c.getColumnIndex(col);
        return idx >= 0 && !c.isNull(idx) ? c.getInt(idx) : 0;
    }

    private static String getString(Cursor c, String col) {
        int idx = c.getColumnIndex(col);
        return idx >= 0 && !c.isNull(idx) ? c.getString(idx) : null;
    }

    private void queryUri(
        ContentResolver resolver,
        Uri uri,
        String kind,
        JSArray items,
        HashMap<Long, JSObject> albums
    ) {
        String[] projection = new String[] {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.DATE_MODIFIED,
            "_data",
            "bucket_id",
            "bucket_display_name",
            "duration"
        };

        Cursor c = null;
        try {
            c = resolver.query(uri, projection, null, null, MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
            if (c == null) return;

            while (c.moveToNext()) {
                long id = getLong(c, MediaStore.MediaColumns._ID);
                String name = getString(c, MediaStore.MediaColumns.DISPLAY_NAME);
                if (name == null) name = "item_" + id;
                String mime = getString(c, MediaStore.MediaColumns.MIME_TYPE);
                if (mime == null) mime = kind.equals("video") ? "video/mp4" : "image/jpeg";

                String ext = "";
                int dot = name.lastIndexOf('.');
                if (dot >= 0 && dot < name.length() - 1) {
                    ext = name.substring(dot + 1).toLowerCase(Locale.US);
                }

                long size = getLong(c, MediaStore.MediaColumns.SIZE);
                int width = getInt(c, MediaStore.MediaColumns.WIDTH);
                int height = getInt(c, MediaStore.MediaColumns.HEIGHT);
                long duration = kind.equals("video") ? getLong(c, "duration") : 0L;

                long takenMs = getLong(c, MediaStore.MediaColumns.DATE_TAKEN);
                long addedSec = getLong(c, MediaStore.MediaColumns.DATE_ADDED);
                long modSec = getLong(c, MediaStore.MediaColumns.DATE_MODIFIED);
                long createdMs = addedSec > 0 ? (addedSec < 100000000000L ? addedSec * 1000L : addedSec) : takenMs;
                long modMs = modSec > 0 ? (modSec < 100000000000L ? modSec * 1000L : modSec) : createdMs;
                if (takenMs <= 0) takenMs = modMs;

                String filePath = getString(c, "_data");
                long bucketId = getLong(c, "bucket_id");
                String bucketName = getString(c, "bucket_display_name");
                if (bucketName == null || bucketName.isEmpty()) bucketName = "Internal Storage";

                String folderPath = null;
                if (filePath != null) {
                    int slash = filePath.lastIndexOf('/');
                    if (slash > 0) folderPath = filePath.substring(0, slash);
                }

                String takenIso = toIso(takenMs);
                String createdIso = toIso(createdMs);
                String modIso = toIso(modMs);

                JSObject item = new JSObject();
                item.put("id", id);
                item.put("albumId", bucketId);
                item.put("name", name);
                item.put("mime", mime);
                item.put("format", ext);
                item.put("kind", kind);
                item.put("size", size);
                item.put("width", width);
                item.put("height", height);
                item.put("previewWidth", width);
                item.put("previewHeight", height);
                item.put("durationMs", duration);
                item.put("animated", mime.contains("gif"));
                item.put("hasPreview", false);
                item.put("takenAt", takenIso);
                item.put("createdAt", createdIso);
                item.put("modifiedAt", modIso);
                item.put("viewedAt", null);
                item.put("editedAt", null);
                item.put("favorite", false);
                item.put("archived", false);
                item.put("vaulted", false);
                item.put("trashedAt", null);
                item.put("trashAlbumId", null);
                item.put("trashAlbumName", null);
                item.put("customOrder", 0);
                item.put("lat", null);
                item.put("lng", null);
                item.put("place", null);
                item.put("camera", null);
                item.put("sourcePath", filePath);
                item.put("albumName", bucketName);
                items.put(item);

                JSObject alb = albums.get(bucketId);
                if (alb == null) {
                    alb = new JSObject();
                    boolean isCam = bucketName.equalsIgnoreCase("Camera")
                        || (folderPath != null && folderPath.toLowerCase(Locale.US).contains("/dcim/camera"));
                    alb.put("id", bucketId);
                    alb.put("name", bucketName);
                    alb.put("kind", "device");
                    alb.put("hint", folderPath != null ? folderPath : "Device folder");
                    alb.put("path", folderPath);
                    alb.put("isCamera", isCam);
                    alb.put("pinned", isCam);
                    alb.put("pinOrder", isCam ? 0 : 99);
                    alb.put("sortOrder", 0);
                    alb.put("hidden", false);
                    alb.put("coverMediaId", id);
                    alb.put("coverId", id);
                    alb.put("coverV", modMs);
                    alb.put("count", 0);
                    alb.put("videoCount", 0);
                    alb.put("size", 0L);
                    alb.put("createdAt", createdIso);
                    alb.put("modifiedAt", modIso);
                    alb.put("lastTaken", takenIso);
                    albums.put(bucketId, alb);
                }

                try {
                    alb.put("count", alb.getInt("count") + 1);
                    if (kind.equals("video")) {
                        alb.put("videoCount", alb.getInt("videoCount") + 1);
                    }
                    alb.put("size", alb.getLong("size") + size);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
    }

    @PluginMethod
    public void scanMedia(PluginCall call) {
        if (!hasMediaReadPermission()) {
            JSObject empty = new JSObject();
            empty.put("items", new JSArray());
            empty.put("albums", new JSArray());
            call.resolve(empty);
            return;
        }

        executor.execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            JSArray items = new JSArray();
            HashMap<Long, JSObject> albumMap = new HashMap<>();

            queryUri(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image", items, albumMap);
            queryUri(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", items, albumMap);

            JSArray albums = new JSArray();
            for (JSObject a : albumMap.values()) {
                albums.put(a);
            }

            JSObject ret = new JSObject();
            ret.put("items", items);
            ret.put("albums", albums);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void getThumb(PluginCall call) {
        long id = getIdArg(call);
        String kind = call.getString("kind", "image");
        String sourcePath = call.getString("sourcePath");

        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "thumbs");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, id + ".jpg");
                if (out.exists() && out.length() > 0) {
                    JSObject res = new JSObject();
                    res.put("path", out.getAbsolutePath());
                    call.resolve(res);
                    return;
                }

                Uri uri = ContentUris.withAppendedId(
                    "video".equals(kind)
                        ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id
                );

                Bitmap bmp = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    bmp = getContext().getContentResolver().loadThumbnail(uri, new Size(360, 360), null);
                } else if ("video".equals(kind)) {
                    bmp = MediaStore.Video.Thumbnails.getThumbnail(
                        getContext().getContentResolver(),
                        id,
                        MediaStore.Video.Thumbnails.MINI_KIND,
                        null
                    );
                } else {
                    bmp = MediaStore.Images.Thumbnails.getThumbnail(
                        getContext().getContentResolver(),
                        id,
                        MediaStore.Images.Thumbnails.MINI_KIND,
                        null
                    );
                }

                if (bmp != null) {
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        bmp.compress(Bitmap.CompressFormat.JPEG, 82, fos);
                    }
                    bmp.recycle();
                    JSObject res = new JSObject();
                    res.put("path", out.getAbsolutePath());
                    call.resolve(res);
                    return;
                }
            } catch (Exception ignored) {}

            JSObject fallback = new JSObject();
            fallback.put("path", sourcePath);
            call.resolve(fallback);
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        long id = getIdArg(call);
        String kind = call.getString("kind", "image");
        String sourcePath = call.getString("sourcePath");

        executor.execute(() -> {
            boolean ok = false;
            try {
                Uri uri = ContentUris.withAppendedId(
                    "video".equals(kind)
                        ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id
                );
                int rows = getContext().getContentResolver().delete(uri, null, null);
                ok = rows > 0;
            } catch (Exception ignored) {}

            if (!ok && sourcePath != null) {
                try {
                    File f = new File(sourcePath);
                    if (f.exists() && f.delete()) {
                        ok = true;
                        MediaScannerConnection.scanFile(getContext(), new String[] { sourcePath }, null, null);
                    }
                } catch (Exception ignored) {}
            }

            JSObject res = new JSObject();
            res.put("ok", ok);
            call.resolve(res);
        });
    }
}
`
);

fs.writeFileSync(
  path.join(javaDir, "MainActivity.java"),
  `package com.prism.gallery;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrismStoragePlugin.class);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }
}
`
);

console.log("Android permissions, PrismStoragePlugin, and fullscreen MainActivity configured.");
