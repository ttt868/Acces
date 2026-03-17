package by.chemerisuk.cordova.firebase;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import static android.content.ContentResolver.SCHEME_ANDROID_RESOURCE;


public class FirebaseMessagingPluginService extends FirebaseMessagingService {
    private static final String TAG = "FCMPluginService";

    public static final String ACTION_FCM_MESSAGE = "by.chemerisuk.cordova.firebase.ACTION_FCM_MESSAGE";
    public static final String EXTRA_FCM_MESSAGE = "by.chemerisuk.cordova.firebase.EXTRA_FCM_MESSAGE";
    public static final String ACTION_FCM_TOKEN = "by.chemerisuk.cordova.firebase.ACTION_FCM_TOKEN";
    public static final String EXTRA_FCM_TOKEN = "by.chemerisuk.cordova.firebase.EXTRA_FCM_TOKEN";
    public final static String NOTIFICATION_ICON_KEY = "com.google.firebase.messaging.default_notification_icon";
    public final static String NOTIFICATION_COLOR_KEY = "com.google.firebase.messaging.default_notification_color";
    public final static String NOTIFICATION_CHANNEL_KEY = "com.google.firebase.messaging.default_notification_channel_id";

    private LocalBroadcastManager broadcastManager;
    private NotificationManager notificationManager;
    private int defaultNotificationIcon;
    private int defaultNotificationColor;
    private String defaultNotificationChannel;

    @Override
    public void onCreate() {
        broadcastManager = LocalBroadcastManager.getInstance(this);
        notificationManager = ContextCompat.getSystemService(this, NotificationManager.class);

        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getApplicationContext().getPackageName(), PackageManager.GET_META_DATA);
            defaultNotificationIcon = ai.metaData.getInt(NOTIFICATION_ICON_KEY, ai.icon);
            defaultNotificationChannel = ai.metaData.getString(NOTIFICATION_CHANNEL_KEY, "default");
            defaultNotificationColor = ContextCompat.getColor(this, ai.metaData.getInt(NOTIFICATION_COLOR_KEY));
        } catch (PackageManager.NameNotFoundException e) {
            Log.e(TAG, "Failed to load meta-data", e);
        } catch(Resources.NotFoundException e) {
            Log.e(TAG, "Failed to load notification color", e);
        }
        // On Android O or greater we need to create a new notification channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Delete old "Firebase" channel if it exists
            try {
                NotificationChannel oldChannel = notificationManager.getNotificationChannel("default");
                if (oldChannel != null) {
                    notificationManager.deleteNotificationChannel("default");
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not delete old notification channel", e);
            }

            // Create new "Access Network" channel
            NotificationChannel defaultChannel = notificationManager.getNotificationChannel(defaultNotificationChannel);
            if (defaultChannel == null) {
                notificationManager.createNotificationChannel(
                        new NotificationChannel(defaultNotificationChannel, "Access Network", NotificationManager.IMPORTANCE_HIGH));
            }
        }
    }

    @Override
    public void onNewToken(String token) {
        FirebaseMessagingPlugin.sendToken(token);

        Intent intent = new Intent(ACTION_FCM_TOKEN);
        intent.putExtra(EXTRA_FCM_TOKEN, token);
        broadcastManager.sendBroadcast(intent);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        FirebaseMessagingPlugin.sendNotification(remoteMessage);

        Intent intent = new Intent(ACTION_FCM_MESSAGE);
        intent.putExtra(EXTRA_FCM_MESSAGE, remoteMessage);
        broadcastManager.sendBroadcast(intent);

        // Handle notification display
        RemoteMessage.Notification notification = remoteMessage.getNotification();
        String msgType = remoteMessage.getData().get("type");

        if ("transaction_received".equals(msgType)) {
            // Transaction: data-only message, get title/body from data payload
            String title = remoteMessage.getData().get("notifTitle");
            String body = remoteMessage.getData().get("notifBody");
            if (notification != null) {
                // Fallback: if notification payload exists, use it
                title = notification.getTitle();
                body = notification.getBody();
            }
            if (title != null && body != null) {
                showAlertWithLogo(title, body);
            }
        } else if (FirebaseMessagingPlugin.isForceShow()) {
            if (notification != null) {
                showAlert(notification);
            }
        }
    }

    private Bitmap loadLogoBitmap() {
        try {
            URL url = new URL("https://accesschain.org/access-logo-1ipfs.png");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setDoInput(true);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.connect();
            InputStream input = connection.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            input.close();
            connection.disconnect();
            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "Failed to load logo bitmap", e);
            return null;
        }
    }

    private void showAlertWithLogo(String title, String body) {
        Bitmap logoBitmap = loadLogoBitmap();

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getApplicationContext().getPackageName());
        PendingIntent pendingIntent = null;
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pendingIntent = PendingIntent.getActivity(this, 0, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, defaultNotificationChannel)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(defaultNotificationIcon)
                .setColor(defaultNotificationColor)
                .setAutoCancel(true)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH);

        if (logoBitmap != null) {
            builder.setLargeIcon(logoBitmap);
        }

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }

        int notifId = (int) System.currentTimeMillis();
        notificationManager.notify(notifId, builder.build());
    }

    private void showAlert(RemoteMessage.Notification notification) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, getNotificationChannel(notification))
                .setSound(getNotificationSound(notification.getSound()))
                .setContentTitle(notification.getTitle())
                .setContentText(notification.getBody())
                .setGroup(notification.getTag())
                .setSmallIcon(defaultNotificationIcon)
                .setColor(defaultNotificationColor)
                // must set priority to make sure forceShow works properly
                .setPriority(1);

        notificationManager.notify(0, builder.build());
        // dismiss notification to hide icon from status bar automatically
        new Handler(getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                notificationManager.cancel(0);
            }
        }, 3000);
    }

    private String getNotificationChannel(RemoteMessage.Notification notification) {
        String channel = notification.getChannelId();
        if (channel == null) {
            return defaultNotificationChannel;
        } else {
            return channel;
        }
    }

    private Uri getNotificationSound(String soundName) {
        if (soundName == null || soundName.isEmpty()) {
            return null;
        } else if (soundName.equals("default")) {
            return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        } else {
            return Uri.parse(SCHEME_ANDROID_RESOURCE + "://" + getApplicationContext().getPackageName() + "/raw/" + soundName);
        }
    }
}
