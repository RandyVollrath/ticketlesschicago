package fyi.ticketless.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale
import kotlin.math.*

/**
 * CameraAlertModule — Native Android camera alert system.
 *
 * Mirrors the iOS BackgroundLocationModule.swift camera alert behavior:
 * - Embedded camera data (510 Chicago cameras)
 * - Proximity detection with dynamic radius (150-250m based on speed)
 * - Heading/bearing matching (45° heading tolerance, 30° ahead cone)
 * - Per-camera debounce (3 min) and global debounce (5 sec)
 * - Android TextToSpeech for voice alerts
 * - Notification channel for visual alerts
 * - Speed camera hours enforcement (6 AM - 11 PM)
 *
 * Called from JS CameraAlertService when location updates arrive.
 * Also provides native TTS that works when JS is suspended.
 */
class CameraAlertModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "CameraAlertModule"
        private const val CHANNEL_ID = "camera_alert_channel"
        private const val NOTIFICATION_ID = 9002

        // Alert thresholds — match iOS values
        private const val BASE_ALERT_RADIUS_METERS = 150.0
        private const val MAX_ALERT_RADIUS_METERS = 250.0
        private const val TARGET_WARNING_SECONDS = 10.0
        private const val HEADING_TOLERANCE_DEGREES = 45.0
        private const val MAX_BEARING_OFF_HEADING_DEGREES = 30.0
        private const val MIN_SPEED_SPEED_CAM_MPS = 3.2   // ~7 mph
        private const val MIN_SPEED_REDLIGHT_MPS = 1.0     // ~2 mph
        private const val BBOX_DEGREES = 0.0025             // ~280m pre-filter
        private const val COOLDOWN_RADIUS_METERS = 400.0
        private const val PER_CAMERA_DEBOUNCE_MS = 3 * 60 * 1000L  // 3 minutes
        private const val GLOBAL_DEBOUNCE_MS = 5000L                 // 5 seconds
        private const val GPS_ACCURACY_REJECT_METERS = 120.0
        private const val SPEED_CAMERA_ENFORCE_START_HOUR = 6
        private const val SPEED_CAMERA_ENFORCE_END_HOUR = 23

        // Approach direction to compass heading mapping
        private val APPROACH_TO_HEADING = mapOf(
            "NB" to 0.0,
            "NEB" to 45.0,
            "EB" to 90.0,
            "SEB" to 135.0,
            "SB" to 180.0,
            "SWB" to 225.0,
            "WB" to 270.0,
            "NWB" to 315.0
        )
    }

    data class CameraDef(
        val type: String,      // "speed" or "redlight"
        val address: String,
        val lat: Double,
        val lng: Double,
        val approaches: List<String>
    )

    // Camera data — injected by generate_android_camera_data.ts
    private val cameras: List<CameraDef> = listOf(
        // CAMERA_ENTRIES_BEGIN
            // Generated from TicketlessChicagoMobile/src/data/chicago-cameras.ts (510 cameras)
            CameraDef("speed", "3450 W 71st St", 41.7644, -87.7097, listOf("WB", "EB")),
            CameraDef("speed", "6247 W Fullerton Ave", 41.9236, -87.7825, listOf("EB")),
            CameraDef("speed", "6250 W Fullerton Ave", 41.9238, -87.7826, listOf("WB")),
            CameraDef("speed", "5509 W Fullerton Ave", 41.9239, -87.7639, listOf("EB")),
            CameraDef("speed", "5446 W Fullerton Ave", 41.9241, -87.763, listOf("WB")),
            CameraDef("speed", "4843 W Fullerton Ave", 41.9241, -87.748, listOf("EB", "WB")),
            CameraDef("speed", "3843 W 111th St", 41.6912, -87.7172, listOf("EB", "WB")),
            CameraDef("speed", "6523 N Western Ave", 42.0003, -87.6898, listOf("NB", "SB")),
            CameraDef("speed", "4433 N Western Ave", 41.9623, -87.6886, listOf("NB")),
            CameraDef("speed", "7739 S Western Ave", 41.7526, -87.6828, listOf("NB")),
            CameraDef("speed", "7738 S Western Ave", 41.75269, -87.6831, listOf("SB")),
            CameraDef("speed", "2550 W 79th St", 41.7502, -87.6874, listOf("WB")),
            CameraDef("speed", "5529 S Western Ave", 41.79249, -87.6839, listOf("SB")),
            CameraDef("speed", "7833 S Pulaski Rd", 41.7504, -87.7218, listOf("NB")),
            CameraDef("speed", "7826 S Pulaski Rd", 41.7505, -87.7221, listOf("SB")),
            CameraDef("speed", "3832 W 79th St", 41.74969, -87.7196, listOf("WB")),
            CameraDef("speed", "115 N Ogden Ave", 41.8832, -87.6641, listOf("NB", "SB")),
            CameraDef("speed", "2721 W Montrose Ave", 41.9611, -87.697, listOf("EB", "WB")),
            CameraDef("speed", "2705 W Irving Park Ave", 41.9539, -87.6962, listOf("EB")),
            CameraDef("speed", "2712 W Irving Park Ave", 41.9541, -87.6966, listOf("WB")),
            CameraDef("speed", "5520 S Western Ave", 41.7928, -87.6842, listOf("NB")),
            CameraDef("speed", "2115 S Western Ave", 41.8534, -87.6855, listOf("NB")),
            CameraDef("speed", "2108 S Western Ave", 41.8536, -87.6858, listOf("SB")),
            CameraDef("speed", "346 W 76th St", 41.7564, -87.6338, listOf("WB")),
            CameraDef("speed", "3542 E 95th St", 41.723, -87.537, listOf("WB")),
            CameraDef("speed", "1110 S Pulaski Rd", 41.8676, -87.7254, listOf("SB")),
            CameraDef("speed", "3212 W 55th St", 41.7936, -87.7042, listOf("WB")),
            CameraDef("speed", "8345 S Ashland Ave", 41.7417, -87.6631, listOf("NB")),
            CameraDef("speed", "3111 N Ashland Ave", 41.9383, -87.6685, listOf("NB")),
            CameraDef("speed", "5006 S Western Blvd", 41.8028, -87.6837, listOf("SB", "NB")),
            CameraDef("speed", "7157 S South Chicago Ave", 41.7647, -87.6037, listOf("NWB")),
            CameraDef("speed", "8043 W Addison St", 41.945, -87.8282, listOf("EB")),
            CameraDef("speed", "5885 N Ridge Ave", 41.98891, -87.66856, listOf("SB", "NB")),
            CameraDef("speed", "2443 N Ashland", 41.92642, -87.66806, listOf("NB")),
            CameraDef("speed", "1732 W 99th St", 41.71398, -87.66672, listOf("EB", "WB")),
            CameraDef("speed", "2700 W 103rd St", 41.7065, -87.6892, listOf("EB", "WB")),
            CameraDef("speed", "10540 S Western Ave", 41.70148, -87.68162, listOf("NB", "SB")),
            CameraDef("speed", "515 S Central Ave", 41.8733, -87.7645, listOf("NB")),
            CameraDef("speed", "4041 W Chicago Ave", 41.8952, -87.7277, listOf("EB")),
            CameraDef("speed", "1901 E 75th St", 41.75869, -87.5785, listOf("EB", "WB")),
            CameraDef("speed", "1117 S Pulaski Rd", 41.8674, -87.7251, listOf("NB")),
            CameraDef("speed", "8318 S Ashland Ave", 41.7425, -87.6634, listOf("SB")),
            CameraDef("speed", "6020 W Foster Ave", 41.9758, -87.7786, listOf("NB", "SB")),
            CameraDef("speed", "8006 W Addison St", 41.945, -87.8271, listOf("WB")),
            CameraDef("speed", "2900 W Ogden Ave", 41.8604, -87.6987, listOf("WB", "EB")),
            CameraDef("speed", "3534 N Western Ave", 41.946, -87.6884, listOf("SB")),
            CameraDef("speed", "4429 N Broadway Ave", 41.9626, -87.6555, listOf("NB")),
            CameraDef("speed", "3137 W Peterson Ave", 41.9903, -87.7095, listOf("EB", "WB")),
            CameraDef("speed", "3115 N Narragansett Ave", 41.93699, -87.7857, listOf("NB")),
            CameraDef("speed", "3911 W Diversey Ave", 41.9318, -87.7254, listOf("EB", "WB")),
            CameraDef("speed", "6226 W Irving Park Rd", 41.9531, -87.7828, listOf("WB", "EB")),
            CameraDef("speed", "1306 W 76th St", 41.756, -87.657, listOf("EB", "WB")),
            CameraDef("speed", "450 N Columbus Dr", 41.89009, -87.6204, listOf("SB")),
            CameraDef("speed", "2917 W Roosevelt Rd", 41.8664, -87.6991, listOf("EB")),
            CameraDef("speed", "901 N Clark St", 41.8988, -87.6313, listOf("SB")),
            CameraDef("speed", "4432 N Lincoln Ave", 41.9623, -87.6846, listOf("SB", "NB")),
            CameraDef("speed", "1444 W Division St", 41.9035, -87.6644, listOf("WB")),
            CameraDef("speed", "3314 W 16th St", 41.8591, -87.7083, listOf("EB", "WB")),
            CameraDef("speed", "3230 N Milwaukee Ave", 41.9397, -87.7251, listOf("SB", "WB")),
            CameraDef("speed", "19 E Chicago Ave", 41.8966, -87.629, listOf("EB")),
            CameraDef("speed", "3100 W Augusta Blvd", 41.89929, -87.7045, listOf("WB", "EB")),
            CameraDef("speed", "8020 W Forest Preserve Ave", 41.9442, -87.8275, listOf("WB", "EB")),
            CameraDef("speed", "732 N Pulaski Rd", 41.8945, -87.7262, listOf("SB", "NB")),
            CameraDef("speed", "7122 S South Chicago Ave", 41.7652, -87.6048, listOf("SEB")),
            CameraDef("speed", "3130 N Ashland Ave", 41.9388, -87.6688, listOf("SB")),
            CameraDef("speed", "1226 S Western Ave", 41.90379, -87.6872, listOf("SB")),
            CameraDef("speed", "6935 W Addison St", 41.94543, -87.80021, listOf("EB", "WB")),
            CameraDef("speed", "4124 W Foster Ave", 41.9755, -87.7317, listOf("WB", "EB")),
            CameraDef("speed", "6125 N Cicero Ave", 41.9921, -87.7485, listOf("NB", "SB")),
            CameraDef("speed", "4925 S Archer Ave", 41.8036, -87.721, listOf("NEB", "SWB")),
            CameraDef("speed", "4350 W 79th St", 41.74949, -87.7289, listOf("WB")),
            CameraDef("speed", "10318 S Indianapolis Ave", 41.7076, -87.5298, listOf("SB", "NB")),
            CameraDef("speed", "445 W 127th St", 41.6632, -87.6337, listOf("EB", "WB")),
            CameraDef("speed", "2928 S Halsted St", 41.8408, -87.6463, listOf("SB", "NB")),
            CameraDef("speed", "5433 S Pulaski Ave", 41.79399, -87.723, listOf("NB")),
            CameraDef("speed", "4246 W 47th St", 41.8078, -87.7301, listOf("WB")),
            CameraDef("speed", "4516 W Marquette Rd", 41.77129, -87.7358, listOf("EB", "WB")),
            CameraDef("speed", "14 W Chicago Ave", 41.8968, -87.6288, listOf("WB")),
            CameraDef("speed", "2638 W Fullerton Ave", 41.9249, -87.6941, listOf("EB", "WB")),
            CameraDef("speed", "1635 N Ashland Ave", 41.9117, -87.6676, listOf("NB")),
            CameraDef("speed", "1229 N Western Ave", 41.9039, -87.6869, listOf("NB")),
            CameraDef("speed", "2329 W Division St", 41.9029, -87.6858, listOf("EB", "WB")),
            CameraDef("speed", "2109 E 87th St", 41.737, -87.5729, listOf("EB", "WB")),
            CameraDef("speed", "6510 W Bryn Mawr Ave", 41.983, -87.7908, listOf("WB")),
            CameraDef("speed", "3217 W 55th St", 41.7934, -87.7043, listOf("EB")),
            CameraDef("speed", "1507 W 83rd St", 41.743, -87.6611, listOf("EB", "WB")),
            CameraDef("speed", "3655 W Jackson Blvd", 41.8771, -87.7182, listOf("EB", "WB")),
            CameraDef("speed", "630 S State St", 41.8738, -87.6277, listOf("SB")),
            CameraDef("speed", "4436 N Western Ave", 41.9624, -87.6889, listOf("SB")),
            CameraDef("speed", "4446 N Broadway Ave", 41.9629, -87.656, listOf("SB")),
            CameraDef("speed", "7508 W Touhy Ave", 42.0116, -87.8142, listOf("EB", "WB")),
            CameraDef("speed", "7518 S Vincennes Ave", 41.7571, -87.6318, listOf("SB", "NB")),
            CameraDef("speed", "4707 W Peterson Ave", 41.9898, -87.7462, listOf("EB")),
            CameraDef("speed", "4674 W Peterson Ave", 41.99, -87.7453, listOf("WB")),
            CameraDef("speed", "2501 W Irving Park Rd", 41.9539, -87.6913, listOf("EB", "WB")),
            CameraDef("speed", "655 W. Root St.", 41.8189, -87.6425, listOf("EB", "WB")),
            CameraDef("speed", "6330 S Dr Martin Luther King Jr Dr", 41.7793, -87.6161, listOf("SB", "NB")),
            CameraDef("speed", "3601 N Milwaukee Ave", 41.9466, -87.736, listOf("NB", "SB")),
            CameraDef("speed", "5432 W Lawrence Ave", 41.9678, -87.7639, listOf("WB", "EB")),
            CameraDef("speed", "4909 N Cicero Ave", 41.9701, -87.7477, listOf("NB", "SB")),
            CameraDef("speed", "4123 N Central Ave", 41.9557, -87.7669, listOf("NB", "SB")),
            CameraDef("speed", "5428 S Pulaski S Rd", 41.79419, -87.7233, listOf("SB")),
            CameraDef("speed", "3851 W 79th St", 41.7494, -87.7191, listOf("EB")),
            CameraDef("speed", "5454 W Irving Park", 41.9533, -87.7643, listOf("WB", "EB")),
            CameraDef("speed", "1142 W Irving Park Rd", 41.9545, -87.6589, listOf("WB", "EB")),
            CameraDef("speed", "11153 S Vincennes Ave", 41.6907, -87.6641, listOf("NB")),
            CameraDef("speed", "536 E Morgan Dr", 41.7935, -87.6119, listOf("EB", "WB")),
            CameraDef("speed", "6514 W Belmont Ave", 41.9384, -87.7891, listOf("WB")),
            CameraDef("speed", "4040 W Chicago Ave", 41.8954, -87.7277, listOf("WB")),
            CameraDef("speed", "1638 N Ashland Ave", 41.9118, -87.6679, listOf("SB")),
            CameraDef("speed", "506 S Central Ave", 41.8736, -87.7648, listOf("SB")),
            CameraDef("speed", "341 W 76th St", 41.7561, -87.6336, listOf("EB")),
            CameraDef("speed", "3535 E 95th St", 41.7228, -87.5376, listOf("EB")),
            CameraDef("speed", "4042 W North Ave", 41.90999, -87.7281, listOf("WB")),
            CameraDef("speed", "1111 N Humboldt Blvd", 41.9014, -87.7021, listOf("SB", "NB")),
            CameraDef("speed", "3521 N Western Ave", 41.9456, -87.6881, listOf("NB")),
            CameraDef("speed", "4929 S Pulaski Rd", 41.8033, -87.7233, listOf("NB")),
            CameraDef("speed", "5030 S Pulaski Rd", 41.8014, -87.7235, listOf("SB")),
            CameraDef("speed", "629 S State St", 41.8738, -87.6274, listOf("NB")),
            CameraDef("speed", "2445 W 51st St", 41.801, -87.6861, listOf("EB")),
            CameraDef("speed", "1455 W Division St", 41.9033, -87.6649, listOf("EB")),
            CameraDef("speed", "3034 W Foster Ave", 41.9759, -87.7048, listOf("WB", "EB")),
            CameraDef("speed", "5330 S Cottage Grove Ave", 41.7977, -87.6064, listOf("SB", "NB")),
            CameraDef("speed", "1215 E 83RD ST", 41.7442, -87.5933, listOf("EB", "WB")),
            CameraDef("speed", "5816 W Jackson Blvd", 41.8772, -87.7704, listOf("WB", "EB")),
            CameraDef("speed", "3809 W Belmont Ave", 41.939, -87.7226, listOf("EB")),
            CameraDef("speed", "4319 W 47th St", 41.8076, -87.7318, listOf("EB")),
            CameraDef("speed", "449 N Columbus Dr", 41.89, -87.6202, listOf("NB")),
            CameraDef("speed", "2432 N Ashland Ave", 41.9262, -87.6683, listOf("SB")),
            CameraDef("speed", "2080 W Pershing Rd", 41.8232, -87.678, listOf("WB", "EB")),
            CameraDef("speed", "4949 W Lawrence Ave", 41.9679, -87.7523, listOf("EB", "WB")),
            CameraDef("speed", "1754 N Pulaski Rd", 41.9134, -87.7266, listOf("SB", "NB")),
            CameraDef("speed", "5120 N Pulaski Rd", 41.9743, -87.7282, listOf("SB", "NB")),
            CameraDef("speed", "3536 S Wallace St", 41.8297, -87.6413, listOf("NB", "SB")),
            CameraDef("speed", "5471 W Higgins Rd", 41.9692, -87.764, listOf("EB", "WB")),
            CameraDef("speed", "6443 W Belmont Ave", 41.9382, -87.7877, listOf("EB")),
            CameraDef("speed", "1334 W Garfield Blvd", 41.79419, -87.6587, listOf("WB")),
            CameraDef("speed", "1315 W Garfield Blvd", 41.7936, -87.6579, listOf("EB")),
            CameraDef("speed", "324 S Kedzie Ave", 41.8766, -87.7061, listOf("NB", "SB")),
            CameraDef("speed", "324 E Illinois St", 41.8909, -87.6193, listOf("EB")),
            CameraDef("speed", "6909 S Kedzie Ave", 41.7677, -87.7027, listOf("NB")),
            CameraDef("speed", "6818 S Kedzie Ave", 41.7691, -87.703, listOf("SB")),
            CameraDef("speed", "2912 W Roosevelt Rd", 41.8666, -87.699, listOf("WB")),
            CameraDef("speed", "2549 W Addison St", 41.9466, -87.6905, listOf("EB", "WB")),
            CameraDef("speed", "57 E 95th St", 41.7216, -87.6215, listOf("WB")),
            CameraDef("speed", "62 E 95th St", 41.7219, -87.6214, listOf("EB")),
            CameraDef("speed", "2440 W 51st St", 41.8012, -87.6859, listOf("WB")),
            CameraDef("speed", "3646 W Madison St", 41.88089, -87.7179, listOf("WB", "EB")),
            CameraDef("speed", "2223 N Kedzie Blvd", 41.92199, -87.707, listOf("NB", "SB")),
            CameraDef("speed", "4620 W Belmont Ave", 41.939, -87.7431, listOf("WB", "EB")),
            CameraDef("speed", "5440 W Grand Ave", 41.9182, -87.7623, listOf("WB", "EB")),
            CameraDef("speed", "2513 W 55th St", 41.7937, -87.6872, listOf("EB", "WB")),
            CameraDef("speed", "3810 W Belmont Ave", 41.9393, -87.7228, listOf("WB")),
            CameraDef("speed", "3047 W Jackson Blvd", 41.8772, -87.7029, listOf("EB", "WB")),
            CameraDef("speed", "3116 N Narragansett Ave", 41.93699, -87.786, listOf("SB")),
            CameraDef("speed", "215 E 63rd St", 41.78, -87.6198, listOf("EB", "WB")),
            CameraDef("speed", "4053 W North Ave", 41.9097, -87.7286, listOf("EB")),
            CameraDef("speed", "5532 S Kedzie Ave", 41.79249, -87.7037, listOf("SB", "NB")),
            CameraDef("speed", "819 E 71st St", 41.7658, -87.6036, listOf("EB", "WB")),
            CameraDef("speed", "1817 N Clark St", 41.9159, -87.6344, listOf("NB", "SB")),
            CameraDef("speed", "8740 S Vincennes St", 41.73469, -87.6459, listOf("SWB", "NEB")),
            CameraDef("speed", "1455 W Grand Ave", 41.891, -87.6646, listOf("EB", "WB")),
            CameraDef("speed", "2310 E 103rd St", 41.7081, -87.5676, listOf("EB", "WB")),
            CameraDef("speed", "4118 N Ashland Ave", 41.9568, -87.669, listOf("NB", "SB")),
            CameraDef("speed", "3510 W 55th St", 41.7935, -87.7121, listOf("EB", "WB")),
            CameraDef("speed", "7115 N Sheridan Rd", 42.0122, -87.663, listOf("NB", "SB")),
            CameraDef("speed", "2716 W Logan Blvd", 41.9286, -87.6958, listOf("EB", "WB")),
            CameraDef("speed", "1341 W Jackson Blvd", 41.8778, -87.6611, listOf("EB", "WB")),
            CameraDef("speed", "4716 N Ashland", 41.9676, -87.6695, listOf("NB", "SB")),
            CameraDef("speed", "3665 N Austin Ave", 41.9473, -87.7765, listOf("NB", "SB")),
            CameraDef("speed", "5059 N Damen Ave", 41.974, -87.6793, listOf("NB", "SB")),
            CameraDef("speed", "6824 W Foster Ave", 41.9756, -87.7986, listOf("EB", "WB")),
            CameraDef("speed", "220 W Fullerton Ave", 41.9258, -87.6349, listOf("EB", "WB")),
            CameraDef("speed", "5432 N Central Ave", 41.98, -87.7683, listOf("NB", "SB")),
            CameraDef("speed", "5857 N Broadway", 41.9887, -87.6601, listOf("NB", "SB")),
            CameraDef("speed", "6151 N Sheridan Rd", 41.9938, -87.6554, listOf("NB", "SB")),
            CameraDef("speed", "7732 S Cottage Grove Ave", 41.75372, -87.60533, listOf("NB", "SB")),
            CameraDef("speed", "2650 W Peterson Ave", 41.9906, -87.6962, listOf("EB", "WB")),
            CameraDef("speed", "3358 S Ashland Ave", 41.83244, -87.66575, listOf("NB", "SB")),
            CameraDef("speed", "6616 N Central Ave", 42.0014, -87.7625, listOf("NB", "SB")),
            CameraDef("speed", "441 E 71st St", 41.76569, -87.61362, listOf("EB", "WB")),
            CameraDef("speed", "8590 S Martin Luther King Dr", 41.7386, -87.6147, listOf("NB", "SB")),
            CameraDef("speed", "1635 N LaSalle", 41.9122, -87.633, listOf("NB", "SB")),
            CameraDef("speed", "49 W 85th St", 41.73991, -87.62662, listOf("EB", "WB")),
            CameraDef("speed", "5941 N Nagle", 41.99002, -87.78753, listOf("NB", "SB")),
            CameraDef("speed", "614 W 47th Street", 41.80901, -87.6416, listOf("EB", "WB")),
            CameraDef("speed", "1477 W. Cermak Rd", 41.8523, -87.6631, listOf("EB", "WB")),
            CameraDef("speed", "147 S Desplaines St", 41.8799, -87.644, listOf("SB")),
            CameraDef("speed", "6201 S Pulaski Rd", 41.78033, -87.72263, listOf("NB")),
            CameraDef("speed", "4021 W Belmont Ave", 41.939, -87.72888, listOf("EB", "WB")),
            CameraDef("speed", "6198 S Pulaski Rd", 41.78037, -87.72297, listOf("SB")),
            CameraDef("speed", "812 S Racine Ave", 41.87141, -87.6569, listOf("NB", "SB")),
            CameraDef("speed", "216 S Jefferson St", 41.87876, -87.64267, listOf("NB")),
            CameraDef("speed", "2948 W 47th St", 41.80827, -87.69862, listOf("EB", "WB")),
            CameraDef("speed", "4298 w 59th St", 41.78593, -87.7301, listOf("EB", "WB")),
            CameraDef("speed", "2718 S Kedzie Ave", 41.84211, -87.7051, listOf("NB", "SB")),
            CameraDef("speed", "851 W 103rd St", 41.70684, -87.6448, listOf("EB", "WB")),
            CameraDef("speed", "3624 S Western Ave", 41.8278, -87.6851, listOf("NB", "SB")),
            CameraDef("speed", "200 S Michigan Ave", 41.87944, -87.62452, listOf("SB")),
            CameraDef("speed", "2711 N Pulaski", 41.9307, -87.7269, listOf("NB", "SB")),
            CameraDef("speed", "451 E Grand Ave", 41.89179, -87.61597, listOf("EB", "WB")),
            CameraDef("speed", "5050 W Fullerton Ave", 41.9242, -87.7534, listOf("EB", "WB")),
            CameraDef("speed", "2622 N. Laramie Ave", 41.92859, -87.75641, listOf("NB", "SB")),
            CameraDef("speed", "4424 W Diversey Ave", 41.93172, -87.73789, listOf("EB", "WB")),
            CameraDef("speed", "8134 S Yates Blvd", 41.74709, -87.56623, listOf("NB", "SB")),
            CameraDef("speed", "2740 S Archer Ave", 41.8442, -87.653, listOf("SEB", "NWB")),
            CameraDef("speed", "504 W 69th Ave", 41.76901, -87.63818, listOf("EB", "WB")),
            CameraDef("speed", "8550 S Lafayette Ave", 41.7388, -87.6256, listOf("SB")),
            CameraDef("speed", "4451 W 79th St", 41.74931, -87.73281, listOf("EB")),
            CameraDef("speed", "2448 Clybourn", 41.9262, -87.6709, listOf("SEB", "NWB")),
            CameraDef("speed", "9618 S. Ewing", 41.7207, -87.5354, listOf("SB", "NB")),
            CameraDef("speed", "385 Michigan Ave", 41.87744, -87.62408, listOf("NB")),
            CameraDef("redlight", "2400 North Central Avenue", 41.92431, -87.7661, listOf("SB")),
            CameraDef("redlight", "800 North Western Ave", 41.89543, -87.6867, listOf("NB")),
            CameraDef("redlight", "6400 West Fullerton Avenue", 41.92356, -87.78583, listOf("EB")),
            CameraDef("redlight", "5600 West Diversey Avenue", 41.93136, -87.76588, listOf("WB")),
            CameraDef("redlight", "2400 West Addison", 41.94665, -87.6887, listOf("EB")),
            CameraDef("redlight", "2400 West Foster Ave", 41.97598, -87.6887, listOf("WB")),
            CameraDef("redlight", "3200 North Pulaski Rd", 41.93935, -87.72729, listOf("SB")),
            CameraDef("redlight", "6000 W Addison Street", 41.94574, -87.77688, listOf("EB")),
            CameraDef("redlight", "11900 South Halsted", 41.67812, -87.64206, listOf("SB")),
            CameraDef("redlight", "4800 West Diversey Avenue", 41.93154, -87.74614, listOf("WB")),
            CameraDef("redlight", "6400 West Fullerton Avenue", 41.92381, -87.7847, listOf("WB")),
            CameraDef("redlight", "7600 South Stony Island Avenue", 41.75671, -87.58561, listOf("NB")),
            CameraDef("redlight", "2400 North Ashland Avenue", 41.92528, -87.66819, listOf("SB")),
            CameraDef("redlight", "1 East 79th Street", 41.75105, -87.62419, listOf("WB")),
            CameraDef("redlight", "1300 W Irving Park Road", 41.95432, -87.66262, listOf("EB")),
            CameraDef("redlight", "2400 North Ashland Avenue", 41.92499, -87.66808, listOf("NB")),
            CameraDef("redlight", "6300 South Kedzie Ave", 41.77869, -87.70305, listOf("NB")),
            CameraDef("redlight", "3200 North Kedzie Avenue", 41.93878, -87.70765, listOf("NB")),
            CameraDef("redlight", "600 South Cicero Avenue", 41.8735, -87.74513, listOf("SB")),
            CameraDef("redlight", "?200 N. Upper Wacker Dr", 41.88547, -87.63681, listOf("NB")),
            CameraDef("redlight", "3200 West 55th Street", 41.79345, -87.70393, listOf("EB")),
            CameraDef("redlight", "5500 S. Pulaski", 41.7937, -87.72329, listOf("SB")),
            CameraDef("redlight", "5075 West Montrose Avenue", 41.96066, -87.75406, listOf("WB")),
            CameraDef("redlight", "400 West Belmont Ave", 41.94017, -87.6389, listOf("EB")),
            CameraDef("redlight", "7100 South Cottage Grove Avenue", 41.76515, -87.60543, listOf("NB")),
            CameraDef("redlight", "150 North Sacramento Boulevard", 41.89529, -87.70209, listOf("NB")),
            CameraDef("redlight", "3700 West Irving Park Road", 41.95376, -87.719, listOf("EB")),
            CameraDef("redlight", "8700 South Vincennes", 41.73643, -87.6451, listOf("SB")),
            CameraDef("redlight", "4000 West Diversey Avenue", 41.93177, -87.72741, listOf("EB")),
            CameraDef("redlight", "3600 North Harlem Avenue", 41.94493, -87.80688, listOf("NB")),
            CameraDef("redlight", "4400 North Western Avenue", 41.961, -87.68862, listOf("NB")),
            CameraDef("redlight", "4700 S. Western Avenue", 41.80813, -87.6843, listOf("NB")),
            CameraDef("redlight", "3200 North Lakeshore Drive", 41.94035, -87.63887, listOf("SB")),
            CameraDef("redlight", "5500 South Kedzie Avenue", 41.79373, -87.70362, listOf("SB")),
            CameraDef("redlight", "1200 West Devon Ave", 41.99813, -87.66099, listOf("EB")),
            CameraDef("redlight", "4000 N Clark Street", 41.95417, -87.66199, listOf("NB")),
            CameraDef("redlight", "848 West 87th Street", 41.73602, -87.64556, listOf("EB")),
            CameraDef("redlight", "4800 West Chicago Avenue", 41.89494, -87.74609, listOf("EB")),
            CameraDef("redlight", "6300 South Pulaski Rd", 41.77891, -87.72291, listOf("SB")),
            CameraDef("redlight", "4400 West Ogden Avenue", 41.84747, -87.73476, listOf("EB")),
            CameraDef("redlight", "4800 North Western Avenue", 41.96898, -87.68897, listOf("SB")),
            CameraDef("redlight", "4440 West Lawrence Avenue", 41.96817, -87.73976, listOf("WB")),
            CameraDef("redlight", "1600 East 79th St", 41.75155, -87.58502, listOf("WB")),
            CameraDef("redlight", "0 N. Ashland Ave", 41.88122, -87.66663, listOf("NB")),
            CameraDef("redlight", "7100 S. Ashland", 41.76456, -87.66366, listOf("NB")),
            CameraDef("redlight", "2000 West Division", 41.90316, -87.67749, listOf("EB")),
            CameraDef("redlight", "800 West 79th Street", 41.75059, -87.64443, listOf("EB")),
            CameraDef("redlight", "800 West Fullerton Avenue", 41.92549, -87.64842, listOf("WB")),
            CameraDef("redlight", "4000 W. 55th St", 41.79326, -87.72274, listOf("WB")),
            CameraDef("redlight", "5930 N Clark Street", 41.98922, -87.66979, listOf("NB")),
            CameraDef("redlight", "1600 West 87th St", 41.73582, -87.66262, listOf("WB")),
            CameraDef("redlight", "2000 East 95th St", 41.72249, -87.57581, listOf("EB")),
            CameraDef("redlight", "4000 West Foster Ave", 41.97559, -87.72792, listOf("WB")),
            CameraDef("redlight", "1200 North Pulaski Road", 41.9025, -87.72621, listOf("NB")),
            CameraDef("redlight", "800 West North Avenue", 41.91095, -87.64784, listOf("WB")),
            CameraDef("redlight", "2800 N Western Avenue", 41.93182, -87.6878, listOf("NB")),
            CameraDef("redlight", "800 North Central Avenue", 41.89513, -87.7655, listOf("SB")),
            CameraDef("redlight", "2400 West North Ave", 41.91026, -87.68769, listOf("EB")),
            CameraDef("redlight", "3200 West Armitage Avenue", 41.91744, -87.70668, listOf("WB")),
            CameraDef("redlight", "1200 South Canal Street", 41.86693, -87.63912, listOf("NB")),
            CameraDef("redlight", "4000 West Armitage Avenue", 41.9172, -87.72625, listOf("WB")),
            CameraDef("redlight", "7900 S. South Chicago Ave", 41.75126, -87.5851, listOf("NB")),
            CameraDef("redlight", "100 West Chicago Avenue", 41.89659, -87.63142, listOf("WB")),
            CameraDef("redlight", "5600 West Fullerton Avenue", 41.92414, -87.7656, listOf("WB")),
            CameraDef("redlight", "3200 W. Belmont", 41.93968, -87.70771, listOf("EB")),
            CameraDef("redlight", "2400 North Western Avenue", 41.92459, -87.68757, listOf("NB")),
            CameraDef("redlight", "3200 West 47th ST", 41.80821, -87.70362, listOf("WB")),
            CameraDef("redlight", "3200 N. Kedzie Ave", 41.93945, -87.7078, listOf("SB")),
            CameraDef("redlight", "6400 North California Avenue", 41.9973, -87.69958, listOf("NB")),
            CameraDef("redlight", "2348 South Kostner Avenue", 41.84804, -87.73451, listOf("SB")),
            CameraDef("redlight", "4000 W Lawrence Avenue", 41.96819, -87.72843, listOf("EB")),
            CameraDef("redlight", "1600 N. Kostner", 41.90956, -87.73627, listOf("NB")),
            CameraDef("redlight", "1600 West Lawrence Avenue", 41.96882, -87.66992, listOf("EB")),
            CameraDef("redlight", "4800 West Peterson Avenue", 41.99, -87.74784, listOf("WB")),
            CameraDef("redlight", "2800 North Central Avenue", 41.93157, -87.76635, listOf("SB")),
            CameraDef("redlight", "7200 West Addison", 41.9452, -87.8075, listOf("EB")),
            CameraDef("redlight", "3000 West Chicago Avenue", 41.89564, -87.70195, listOf("WB")),
            CameraDef("redlight", "4400 W. North", 41.90973, -87.73652, listOf("EB")),
            CameraDef("redlight", "9900 South Halsted St", 41.71402, -87.6428, listOf("NB")),
            CameraDef("redlight", "1600 North Western Ave", 41.91014, -87.68715, listOf("NB")),
            CameraDef("redlight", "6400 North Western Avenue", 41.99745, -87.6898, listOf("NB")),
            CameraDef("redlight", "30 West 87th Street", 41.7362, -87.62583, listOf("EB")),
            CameraDef("redlight", "2800 West Diversey", 41.92331, -87.69719, listOf("WB")),
            CameraDef("redlight", "1900 North Ashland Ave", 41.9159, -87.66777, listOf("NB")),
            CameraDef("redlight", "2400 West 63rd St", 41.77921, -87.68403, listOf("EB")),
            CameraDef("redlight", "2000 W Diversey Parkway", 41.9323, -87.67803, listOf("WB")),
            CameraDef("redlight", "2000 North Kedzie Avenue", 41.91757, -87.70707, listOf("SB")),
            CameraDef("redlight", "7200 North Western Avenue", 42.01199, -87.69015, listOf("NB")),
            CameraDef("redlight", "2800 West Devon Avenue", 41.99752, -87.69997, listOf("EB")),
            CameraDef("redlight", "2800 North Cicero Avenue", 41.93127, -87.74651, listOf("NB")),
            CameraDef("redlight", "4200 South Cicero Avenue", 41.81709, -87.74322, listOf("NB")),
            CameraDef("redlight", "5200 North Broadway St", 41.97605, -87.65979, listOf("NB")),
            CameraDef("redlight", "2400 W Diversey Avenue", 41.93229, -87.68739, listOf("WB")),
            CameraDef("redlight", "4000 West Belmont Ave", 41.93901, -87.72757, listOf("EB")),
            CameraDef("redlight", "2400 West Cermak Road", 41.85196, -87.68613, listOf("EB")),
            CameraDef("redlight", "6000 North Cicero Avenue", 41.9903, -87.74836, listOf("SB")),
            CameraDef("redlight", "2400 West Montrose Avenue", 41.96135, -87.6883, listOf("WB")),
            CameraDef("redlight", "8700 South Lafayette Avenue", 41.73666, -87.62552, listOf("SB")),
            CameraDef("redlight", "2600 South Kedzie Avenue", 41.84478, -87.70512, listOf("SB")),
            CameraDef("redlight", "4800 West Harrison Street", 41.87305, -87.74539, listOf("EB")),
            CameraDef("redlight", "3200 North Harlem Ave", 41.93766, -87.80668, listOf("NB")),
            CameraDef("redlight", "1000 West Foster Ave", 41.97645, -87.65452, listOf("WB")),
            CameraDef("redlight", "3600 North Cicero Avenue", 41.94579, -87.74696, listOf("NB")),
            CameraDef("redlight", "1 East 75th Street", 41.75823, -87.62424, listOf("WB")),
            CameraDef("redlight", "800 West Roosevelt Road", 41.86703, -87.64739, listOf("EB")),
            CameraDef("redlight", "5600 West Belmont Avenue", 41.93868, -87.76606, listOf("WB")),
            CameraDef("redlight", "4000 N Central Avenue", 41.95348, -87.76704, listOf("SB")),
            CameraDef("redlight", "1600 North Homan Avenue", 41.90982, -87.71185, listOf("NB")),
            CameraDef("redlight", "800 North Sacramento Avenue", 41.88375, -87.70118, listOf("NB")),
            CameraDef("redlight", "3216 West Addison St", 41.94653, -87.70919, listOf("EB")),
            CameraDef("redlight", "4700 South Cicero Ave", 41.80796, -87.74333, listOf("SB")),
            CameraDef("redlight", "5000 South Archer Ave", 41.80194, -87.72385, listOf("EB")),
            CameraDef("redlight", "2400 North Clark St", 41.92504, -87.64018, listOf("NB")),
            CameraDef("redlight", "5930 N Clark Street", 41.99019, -87.67017, listOf("SB")),
            CameraDef("redlight", "2400 West 79th St", 41.75014, -87.6824, listOf("WB")),
            CameraDef("redlight", "3600 North Elston Ave", 41.94686, -87.70926, listOf("SB")),
            CameraDef("redlight", "6400 North Sheridan Road", 41.99852, -87.66062, listOf("SB")),
            CameraDef("redlight", "?628 N. Michigan Ave", 41.89368, -87.62433, listOf("SB")),
            CameraDef("redlight", "2400 N Laramie Avenue", 41.92385, -87.75611, listOf("NB")),
            CameraDef("redlight", "4800 North Elston Avenue", 41.9679, -87.73976, listOf("SB")),
            CameraDef("redlight", "5200 West Madison Street", 41.88026, -87.75554, listOf("WB")),
            CameraDef("redlight", "1200 South Pulaski Road", 41.86586, -87.72508, listOf("NB")),
            CameraDef("redlight", "4000 North Pulaski Road", 41.95398, -87.72769, listOf("SB")),
            CameraDef("redlight", "1 S. Western Ave", 41.88092, -87.68626, listOf("NB")),
            CameraDef("redlight", "?300 S. Michigan Ave", 41.87795, -87.62412, listOf("NB")),
            CameraDef("redlight", "1600 West Cortland St", 41.91607, -87.66832, listOf("EB")),
            CameraDef("redlight", "9500 South Jeffery Ave", 41.72281, -87.57541, listOf("SB")),
            CameraDef("redlight", "3500 S. Western", 41.83059, -87.68515, listOf("SB")),
            CameraDef("redlight", "500 North Columbus Drive", 41.89073, -87.62014, listOf("SB")),
            CameraDef("redlight", "500 West Roosevelt Road", 41.86737, -87.6387, listOf("WB")),
            CameraDef("redlight", "500 North Columbus Drive", 41.89121, -87.62023, listOf("NB")),
            CameraDef("redlight", "3600 North Western Avenue", 41.94652, -87.68803, listOf("SB")),
            CameraDef("redlight", "100 North Cicero Avenue", 41.88216, -87.74545, listOf("NB")),
            CameraDef("redlight", "6700 South Western Avenue", 41.77225, -87.68358, listOf("SB")),
            CameraDef("redlight", "1200 S. Kostner", 41.86578, -87.73486, listOf("NB")),
            CameraDef("redlight", "5200 West Irving Park Road", 41.95338, -87.75672, listOf("WB")),
            CameraDef("redlight", "2000 West Division", 41.90323, -87.67686, listOf("WB")),
            CameraDef("redlight", "6400 North Western Avenue", 41.99803, -87.68997, listOf("SB")),
            CameraDef("redlight", "5200 South Cicero Ave", 41.79817, -87.74373, listOf("NB")),
            CameraDef("redlight", "3200 West 63rd St", 41.77903, -87.70277, listOf("WB")),
            CameraDef("redlight", "800 West 111th St", 41.69254, -87.64193, listOf("WB")),
            CameraDef("redlight", "3100 S Dr Martin L King", 41.83813, -87.61723, listOf("NB")),
            CameraDef("redlight", "4800 N Pulaski Road", 41.96852, -87.72811, listOf("SB")),
            CameraDef("redlight", "6300 South Damen Avenue", 41.77954, -87.67397, listOf("SB")),
            CameraDef("redlight", "4400 W. Roosevelt", 41.86595, -87.73539, listOf("EB")),
            CameraDef("redlight", "7200 North Western Avenue", 42.0126, -87.69031, listOf("SB")),
            CameraDef("redlight", "2200 S. Pulaski", 41.85195, -87.72489, listOf("SB")),
            CameraDef("redlight", "100 West Chicago Avenue", 41.89667, -87.63101, listOf("EB")),
            CameraDef("redlight", "2400 North Pulaski Rd", 41.92416, -87.72677, listOf("NB")),
            CameraDef("redlight", "2400 West Chicago Ave", 41.8957, -87.68737, listOf("EB")),
            CameraDef("redlight", "1 North Halsted Street", 41.88207, -87.64748, listOf("SB")),
            CameraDef("redlight", "5200 North Sheridan Road", 41.97666, -87.65504, listOf("SB")),
            CameraDef("redlight", "300 North Hamlin Avenue", 41.88494, -87.72081, listOf("NB")),
            CameraDef("redlight", "1000 West Hollywood Ave", 41.98561, -87.65477, listOf("WB")),
            CameraDef("redlight", "4700 West Irving Park Road", 41.95356, -87.74428, listOf("WB")),
            CameraDef("redlight", "6300 South Damen Avenue", 41.77903, -87.67381, listOf("NB")),
            CameraDef("redlight", "2400 West Van Buren Street", 41.87617, -87.68575, listOf("WB")),
            CameraDef("redlight", "2400 W. Madison", 41.88125, -87.68591, listOf("WB")),
            CameraDef("redlight", "800 West Roosevelt Road", 41.86728, -87.64644, listOf("WB")),
            CameraDef("redlight", "6000 North California Avenue", 41.99013, -87.69936, listOf("NB")),
            CameraDef("redlight", "1200 North Ashland Avenue", 41.90305, -87.66736, listOf("NB")),
            CameraDef("redlight", "3400 West North Ave", 41.91002, -87.7121, listOf("EB")),
            CameraDef("redlight", "7600 South Stony Island Avenue", 41.75717, -87.58617, listOf("SB")),
            CameraDef("redlight", "3200 West 79th St", 41.74964, -87.70275, listOf("EB")),
            CameraDef("redlight", "2400 West Lawrence Avenue", 41.96856, -87.68937, listOf("EB")),
            CameraDef("redlight", "4000 West Irving Park Rd", 41.95372, -87.72724, listOf("WB")),
            CameraDef("redlight", "1000 West Hollywood Ave", 41.98548, -87.65564, listOf("EB")),
            CameraDef("redlight", "7432 West Touhy Avenue", 42.01161, -87.81185, listOf("WB")),
            CameraDef("redlight", "5500 South Wentworth Avenue", 41.79383, -87.63034, listOf("NB")),
            CameraDef("redlight", "3200 North Central Avenue", 41.93893, -87.76666, listOf("SB")),
            CameraDef("redlight", "4000 West Armitage Avenue", 41.91713, -87.72678, listOf("EB")),
            CameraDef("redlight", "4000 West 63rd St", 41.7786, -87.72325, listOf("EB")),
            CameraDef("redlight", "7100 South Cottage Grove Avenue", 41.76633, -87.60571, listOf("SB")),
            CameraDef("redlight", "4000 West Roosevelt Road", 41.86627, -87.72473, listOf("WB")),
            CameraDef("redlight", "5200 N. Nagle", 41.97543, -87.7877, listOf("NB")),
            CameraDef("redlight", "1600 N Pulaski Avenue", 41.90967, -87.72636, listOf("SB")),
            CameraDef("redlight", "5400 South Archer Ave", 41.79887, -87.74237, listOf("WB")),
            CameraDef("redlight", "150 North Sacramento Boulevard", 41.8844, -87.7014, listOf("SB")),
            CameraDef("redlight", "7900 South Western Ave", 41.74973, -87.6827, listOf("NB")),
            CameraDef("redlight", "7900 South Kedzie Ave", 41.75017, -87.70255, listOf("SB")),
            CameraDef("redlight", "4000 N Austin Avenue", 41.95277, -87.77671, listOf("NB")),
            CameraDef("redlight", "?5200 N. Northwest Hwy", 41.97592, -87.76981, listOf("SB")),
            CameraDef("redlight", "2800 West Irving Park Road", 41.95387, -87.69863, listOf("EB")),
            CameraDef("redlight", "1600 W. Madison", 41.88156, -87.6664, listOf("WB")),
            CameraDef("redlight", "200 West Garfield Blvd", 41.79446, -87.63011, listOf("WB")),
            CameraDef("redlight", "6700 South Stony Island Ave", 41.77319, -87.58617, listOf("NB")),
            CameraDef("redlight", "1600 West Division Street", 41.90332, -87.66781, listOf("EB")),
            CameraDef("redlight", "2400 W. Peterson", 41.99099, -87.68974, listOf("SB")),
            CameraDef("redlight", "7100 South Kedzie Avenue", 41.76468, -87.7029, listOf("SB")),
            CameraDef("redlight", "2400 North Halsted Street", 41.9251, -87.64868, listOf("NB")),
            CameraDef("redlight", "7500 South State Street", 41.75788, -87.62489, listOf("NB")),
            CameraDef("redlight", "7900 South Stony Island Ave", 41.75203, -87.5859, listOf("SB")),
            CameraDef("redlight", "4800 W North Avenue", 41.9095, -87.74644, listOf("EB")),
            CameraDef("redlight", "3800 West Madison Street", 41.88071, -87.72117, listOf("EB")),
            CameraDef("redlight", "2800 West Peterson Avenue", 41.99039, -87.69978, listOf("EB")),
            CameraDef("redlight", "2000 North Cicero Avenue", 41.91675, -87.74604, listOf("NB")),
            CameraDef("redlight", "1 South Halsted Street", 41.8815, -87.64725, listOf("NB")),
            CameraDef("redlight", "6000 N. Western Ave", 41.99057, -87.68892, listOf("WB")),
            CameraDef("redlight", "9500 South Halsted Street", 41.72211, -87.64359, listOf("SB")),
            CameraDef("redlight", "6300 South State St", 41.78026, -87.6254, listOf("SB")),
            CameraDef("redlight", "4800 West Fullerton Ave", 41.92431, -87.74588, listOf("WB")),
            CameraDef("redlight", "5600 W Irving Park Road", 41.95313, -87.76743, listOf("EB")),
            CameraDef("redlight", "5200 West Madison Street", 41.8805, -87.75465, listOf("EB")),
            CameraDef("redlight", "2400 North Western Avenue", 41.92524, -87.6878, listOf("SB")),
            CameraDef("redlight", "1200 West Foster Ave", 41.97626, -87.66029, listOf("EB")),
            CameraDef("redlight", "3600 North Central Avenue", 41.94606, -87.76672, listOf("SB")),
            CameraDef("redlight", "4800 West 47th St", 41.80774, -87.74265, listOf("WB")),
            CameraDef("redlight", "4000 W North Avenue", 41.9099, -87.726, listOf("WB")),
            CameraDef("redlight", "2800 North Kimball Avenue", 41.93172, -87.71224, listOf("NB")),
            CameraDef("redlight", "4000 West 79th Street", 41.74961, -87.72139, listOf("WB")),
            CameraDef("redlight", "6000 W Irving Park Road", 41.95299, -87.77715, listOf("EB")),
            CameraDef("redlight", "1600 North Halsted Street", 41.91061, -87.6482, listOf("NB")),
            CameraDef("redlight", "2800 North California Ave", 41.93188, -87.69745, listOf("NB")),
            CameraDef("redlight", "6000 W Diversey Avenue", 41.93103, -87.77638, listOf("EB")),
            CameraDef("redlight", "7900 South State Street", 41.75069, -87.62512, listOf("NB")),
            CameraDef("redlight", "5600 West Lake Street", 41.88771, -87.76539, listOf("EB")),
            CameraDef("redlight", "6700 South Cornell Drive", 41.77311, -87.58586, listOf("NB")),
            CameraDef("redlight", "?100 E. Ontario St", 41.89335, -87.6237, listOf("WB")),
            CameraDef("redlight", "5500 S Western Ave", 41.79419, -87.68421, listOf("SB")),
            CameraDef("redlight", "7900 South Pulaski Road", 41.74985, -87.72204, listOf("SB")),
            CameraDef("redlight", "2000 West Fullerton Ave", 41.92494, -87.67859, listOf("EB")),
            CameraDef("redlight", "6400 North Milwaukee Avenue", 41.99763, -87.78822, listOf("SB")),
            CameraDef("redlight", "2800 North Pulaski Road", 41.93207, -87.72703, listOf("SB")),
            CameraDef("redlight", "800 W. DIVISION", 41.90368, -87.6477, listOf("WB")),
            CameraDef("redlight", "5200 North Pulaski Rd", 41.97583, -87.72831, listOf("SB")),
            CameraDef("redlight", "4800 North Cicero Ave", 41.9676, -87.74766, listOf("NB")),
            CameraDef("redlight", "3200 West 71st Street", 41.76445, -87.70238, listOf("WB")),
            CameraDef("redlight", "1600 W. 71st", 41.76495, -87.66336, listOf("WB")),
            CameraDef("redlight", "?5232 N. Central Ave", 41.97706, -87.7685, listOf("SB")),
            CameraDef("redlight", "5600 West Chicago Avenue", 41.89479, -87.76558, listOf("EB")),
            CameraDef("redlight", "6000 W Diversey Avenue", 41.93119, -87.77562, listOf("WB")),
            CameraDef("redlight", "3100 South Kedzie Avenue", 41.83753, -87.70493, listOf("SB")),
            CameraDef("redlight", "4400 West Grand Ave", 41.9101, -87.73653, listOf("SB")),
            CameraDef("redlight", "1600 West 95th Street", 41.72109, -87.66314, listOf("EB")),
            CameraDef("redlight", "2426 North Damen Ave", 41.9261, -87.67801, listOf("SB")),
            CameraDef("redlight", "3400 West Diversey Avenue", 41.93192, -87.71264, listOf("EB")),
            CameraDef("redlight", "7432 West Touhy Avenue", 42.01151, -87.81262, listOf("EB")),
            CameraDef("redlight", "5200 West Irving Park Road", 41.95322, -87.75741, listOf("EB")),
            CameraDef("redlight", "4700 S. Western Avenue", 41.80873, -87.68457, listOf("SB")),
            CameraDef("redlight", "300 North Hamlin Avenue", 41.8855, -87.72103, listOf("SB")),
            CameraDef("redlight", "?340 W. Upper?Wacker Dr", 41.88597, -87.63743, listOf("SB")),
            CameraDef("redlight", "6400 W. Irving Pk", 41.95289, -87.78691, listOf("EB")),
            CameraDef("redlight", "2400 North Cicero Ave", 41.92458, -87.74644, listOf("SB")),
            CameraDef("redlight", "4000 West Fullerton Ave", 41.92461, -87.72642, listOf("WB")),
            CameraDef("redlight", "3600 North Cicero Avenue", 41.94636, -87.74715, listOf("SB")),
            CameraDef("redlight", "4000 West Chicago Avenue", 41.89532, -87.72632, listOf("EB")),
            CameraDef("redlight", "5200 North Western Ave", 41.97613, -87.68922, listOf("SB")),
            CameraDef("redlight", "4800 North Cicero Avenue", 41.96832, -87.74765, listOf("SB")),
            CameraDef("redlight", "5000 South Archer Ave", 41.80269, -87.72302, listOf("WB")),
            CameraDef("redlight", "2600 South Kedzie Avenue", 41.84408, -87.70494, listOf("NB")),
            CameraDef("redlight", "2400 West Marquette Road", 41.77203, -87.68299, listOf("WB")),
            CameraDef("redlight", "1200 N. HALSTED", 41.90335, -87.64802, listOf("NB")),
            CameraDef("redlight", "6400 W. Irving Pk", 41.95301, -87.78627, listOf("WB")),
            CameraDef("redlight", "?5616 W. Foster Ave", 41.97561, -87.76988, listOf("EB")),
            CameraDef("redlight", "9500 South Halsted Street", 41.72126, -87.64299, listOf("NB")),
            CameraDef("redlight", "400 North Central Avenue", 41.88794, -87.76513, listOf("SB")),
            CameraDef("redlight", "1200 North Pulaski Road", 41.9029, -87.72635, listOf("SB")),
            CameraDef("redlight", "2200 South Western Avenue", 41.85273, -87.68579, listOf("SB")),
            CameraDef("redlight", "6400 W. Foster", 41.9757, -87.78743, listOf("WB")),
            CameraDef("redlight", "7200 West Belmont Ave", 41.93807, -87.80636, listOf("WB")),
            CameraDef("redlight", "4700 West Irving Park Road", 41.95334, -87.7451, listOf("EB")),
            CameraDef("redlight", "2800 West Diversey", 41.93207, -87.698, listOf("EB")),
            CameraDef("redlight", "6400 West Devon Avenue", 41.99739, -87.78737, listOf("WB")),
            CameraDef("redlight", "4700 South Kedzie Ave", 41.80782, -87.70386, listOf("NB")),
            CameraDef("redlight", "100 North Cicero Avenue", 41.88148, -87.74521, listOf("SB")),
            CameraDef("redlight", "?100 E. Jackson Blvd", 41.87823, -87.62485, listOf("EB")),
            CameraDef("redlight", "3500 S. Western", 41.83, -87.6849, listOf("NB")),
            CameraDef("redlight", "3200 West 31st Street", 41.83732, -87.70445, listOf("WB")),
            CameraDef("redlight", "1600 West Irving Park Road", 41.95419, -87.6695, listOf("EB")),
            CameraDef("redlight", "4000 W. Cermak", 41.85172, -87.72434, listOf("WB")),
            CameraDef("redlight", "4400 North Milwaukee Avenue", 41.96043, -87.75419, listOf("SB")),
            CameraDef("redlight", "5600 West Addison Street", 41.94582, -87.76717, listOf("EB")),
            CameraDef("redlight", "4000 North Ashland Avenue", 41.95401, -87.66889, listOf("NB")),
            CameraDef("redlight", "11100 South Halsted St", 41.69259, -87.64251, listOf("SB")),
            CameraDef("redlight", "800 North Pulaski Road", 41.89562, -87.7261, listOf("SB")),
            CameraDef("redlight", "4800 West Armitage Avenue", 41.91687, -87.74654, listOf("EB")),
            CameraDef("redlight", "6300 South Western Ave", 41.77893, -87.68351, listOf("NB")),
            CameraDef("redlight", "4800 W North Avenue", 41.90972, -87.74573, listOf("WB")),
            CameraDef("redlight", "800 West 99th St", 41.714, -87.64329, listOf("EB")),
            CameraDef("redlight", "800 West 119th Street", 41.67786, -87.64154, listOf("WB")),
            CameraDef("redlight", "0 North Hamlin Boulevard", 41.8805, -87.72058, listOf("NB")),
            CameraDef("redlight", "2800 West Irving Park Road", 41.95409, -87.69779, listOf("WB")),
            CameraDef("redlight", "1 East 63rd St", 41.78008, -87.62507, listOf("WB")),
            CameraDef("redlight", "7900 South Halsted Street", 41.75044, -87.64395, listOf("SB")),
            CameraDef("redlight", "400 East 31st Street", 41.83835, -87.61806, listOf("EB")),
            CameraDef("redlight", "5200 W Fullerton Avenue", 41.92421, -87.75571, listOf("WB")),
            CameraDef("redlight", "4800 North Ashland Avenue", 41.96914, -87.66957, listOf("SB")),
            CameraDef("redlight", "2400 W 55th Street", 41.79378, -87.68451, listOf("EB")),
            CameraDef("redlight", "3600 N Austin Avenue", 41.94599, -87.77642, listOf("NB")),
            CameraDef("redlight", "4000 North Elston Avenue", 41.95405, -87.71979, listOf("SB")),
            CameraDef("redlight", "8700 South Ashland Ave", 41.73609, -87.66307, listOf("SB")),
            CameraDef("redlight", "9500 South Ashland Avenue", 41.72157, -87.66285, listOf("SB")),
            CameraDef("redlight", "800 North Cicero Avenue", 41.89484, -87.74573, listOf("NB")),
            CameraDef("redlight", "2400 North Clark St", 41.92575, -87.64063, listOf("SB")),
            CameraDef("redlight", "2800 N Damen Avenue", 41.93248, -87.67814, listOf("SB")),
            CameraDef("redlight", "?5232 N. Milwaukee Ave", 41.97672, -87.76878, listOf("SEB")),
            CameraDef("redlight", "400 South Western Avenue", 41.87651, -87.68647, listOf("SB")),
            CameraDef("redlight", "4200 South Cicero Avenue", 41.81737, -87.7436, listOf("SB")),
            // CAMERA_ENTRIES_END
    )

    // State
    private var isEnabled = false
    private var speedAlertsEnabled = true
    private var redLightAlertsEnabled = true
    private var alertVolume = 1.0f

    // Debounce tracking: camera index -> last alert timestamp
    private val alertedCameras = mutableMapOf<Int, Long>()
    private var lastGlobalAlertTime = 0L

    // TTS
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        createNotificationChannel()
    }

    override fun getName(): String = "CameraAlertModule"

    // =========================================================================
    // React Native bridge methods
    // =========================================================================

    /**
     * Configure camera alert settings from JS.
     * Called whenever the user toggles camera alerts in settings.
     */
    @ReactMethod
    fun configure(
        enabled: Boolean,
        speedEnabled: Boolean,
        redLightEnabled: Boolean,
        volume: Double,
        promise: Promise
    ) {
        this.isEnabled = enabled
        this.speedAlertsEnabled = speedEnabled
        this.redLightAlertsEnabled = redLightEnabled
        this.alertVolume = volume.toFloat().coerceIn(0f, 1f)

        if (enabled && tts == null) {
            initTts()
        }

        Log.i(TAG, "Configured: enabled=$enabled speed=$speedEnabled redlight=$redLightEnabled volume=$alertVolume cameras=${cameras.size}")
        promise.resolve(true)
    }

    /**
     * Process a location update from JS.
     * This is the main entry point — called on each GPS fix while driving.
     * Returns the number of alerts fired (0 or 1).
     */
    @ReactMethod
    fun onLocationUpdate(
        latitude: Double,
        longitude: Double,
        speed: Double,
        heading: Double,
        accuracy: Double,
        promise: Promise
    ) {
        if (!isEnabled) {
            promise.resolve(0)
            return
        }

        // Reject wildly inaccurate GPS fixes
        if (accuracy > 0 && accuracy > GPS_ACCURACY_REJECT_METERS) {
            promise.resolve(0)
            return
        }

        try {
            val alertsFired = checkCameraProximity(latitude, longitude, speed, heading)
            promise.resolve(alertsFired)
        } catch (e: Exception) {
            Log.e(TAG, "Error in onLocationUpdate", e)
            promise.resolve(0)
        }
    }

    /**
     * Speak a camera alert message via native TTS.
     * Can be called directly from JS as a fallback.
     */
    @ReactMethod
    fun speakAlert(message: String, promise: Promise) {
        if (!ttsReady) {
            initTts()
            // Queue speech after init
            mainHandler.postDelayed({
                doSpeak(message)
                promise.resolve(true)
            }, 500)
            return
        }
        doSpeak(message)
        promise.resolve(true)
    }

    /**
     * Clear all debounce state. Called when a new drive session starts.
     */
    @ReactMethod
    fun clearState(promise: Promise) {
        alertedCameras.clear()
        lastGlobalAlertTime = 0
        Log.d(TAG, "Camera alert state cleared")
        promise.resolve(true)
    }

    /**
     * Get diagnostic info about the native camera alert state.
     */
    @ReactMethod
    fun getStatus(promise: Promise) {
        val result = Arguments.createMap().apply {
            putBoolean("enabled", isEnabled)
            putBoolean("speedAlertsEnabled", speedAlertsEnabled)
            putBoolean("redLightAlertsEnabled", redLightAlertsEnabled)
            putInt("totalCameras", cameras.size)
            putInt("alertedCount", alertedCameras.size)
            putBoolean("ttsReady", ttsReady)
        }
        promise.resolve(result)
    }

    // =========================================================================
    // Core proximity detection
    // =========================================================================

    private fun checkCameraProximity(lat: Double, lng: Double, speed: Double, heading: Double): Int {
        val now = System.currentTimeMillis()

        // Clear cooldowns for cameras we've moved far from
        val iterator = alertedCameras.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            val cam = cameras.getOrNull(entry.key) ?: continue
            val dist = haversineDistance(lat, lng, cam.lat, cam.lng)
            if (dist > COOLDOWN_RADIUS_METERS) {
                iterator.remove()
            }
        }

        // Global debounce
        if (now - lastGlobalAlertTime < GLOBAL_DEBOUNCE_MS) return 0

        // Compute speed-adaptive radius
        val alertRadius = getAlertRadius(speed)

        // Bounding box pre-filter
        val latMin = lat - BBOX_DEGREES
        val latMax = lat + BBOX_DEGREES
        val lngMin = lng - BBOX_DEGREES
        val lngMax = lng + BBOX_DEGREES

        val currentHour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)

        var bestIndex = -1
        var bestDistance = Double.MAX_VALUE

        for (i in cameras.indices) {
            val cam = cameras[i]

            // Type filter
            if (!isCameraTypeEnabled(cam.type, currentHour)) continue

            // Speed filter
            if (speed >= 0) {
                val minSpeed = if (cam.type == "speed") MIN_SPEED_SPEED_CAM_MPS else MIN_SPEED_REDLIGHT_MPS
                if (speed < minSpeed) continue
            }

            // Bounding box
            if (cam.lat < latMin || cam.lat > latMax) continue
            if (cam.lng < lngMin || cam.lng > lngMax) continue

            // Exact distance
            val distance = haversineDistance(lat, lng, cam.lat, cam.lng)
            if (distance > alertRadius) continue

            // Heading match
            if (!isHeadingMatch(heading, cam.approaches)) continue

            // Bearing check: camera must be ahead (within ±30° cone)
            if (!isCameraAhead(lat, lng, cam.lat, cam.lng, heading)) continue

            // Per-camera debounce
            val lastAlertTime = alertedCameras[i] ?: 0L
            if (now - lastAlertTime < PER_CAMERA_DEBOUNCE_MS) continue

            // Pick closest
            if (distance < bestDistance) {
                bestDistance = distance
                bestIndex = i
            }
        }

        if (bestIndex >= 0) {
            val cam = cameras[bestIndex]
            alertedCameras[bestIndex] = now
            lastGlobalAlertTime = now

            val message = if (cam.type == "redlight") "Red-light camera ahead." else "Speed camera ahead."
            Log.i(TAG, "CAMERA ALERT: $message — ${cam.address} (${bestDistance.toInt()}m, speed=${(speed * 2.237).toInt()}mph)")

            // Speak via TTS
            doSpeak(message)

            // Also fire a notification
            fireNotification(cam, bestDistance)

            // Emit event to JS for logging/tracking
            emitAlertEvent(cam, bestDistance, speed)

            return 1
        }

        return 0
    }

    private fun isCameraTypeEnabled(type: String, currentHour: Int): Boolean {
        if (type == "speed") {
            if (!speedAlertsEnabled) return false
            if (currentHour < SPEED_CAMERA_ENFORCE_START_HOUR || currentHour >= SPEED_CAMERA_ENFORCE_END_HOUR) return false
            return true
        }
        return redLightAlertsEnabled
    }

    private fun getAlertRadius(speed: Double): Double {
        if (speed < 0) return BASE_ALERT_RADIUS_METERS
        val dynamic = speed * TARGET_WARNING_SECONDS
        return dynamic.coerceIn(BASE_ALERT_RADIUS_METERS, MAX_ALERT_RADIUS_METERS)
    }

    // =========================================================================
    // Direction matching
    // =========================================================================

    private fun isHeadingMatch(heading: Double, approaches: List<String>): Boolean {
        if (heading < 0) return true // No heading — fail open
        if (approaches.isEmpty()) return true

        for (approach in approaches) {
            val targetHeading = APPROACH_TO_HEADING[approach] ?: return true // Unknown code — fail open
            var diff = abs(heading - targetHeading)
            if (diff > 180) diff = 360 - diff
            if (diff <= HEADING_TOLERANCE_DEGREES) return true
        }
        return false
    }

    private fun isCameraAhead(userLat: Double, userLng: Double, camLat: Double, camLng: Double, heading: Double): Boolean {
        if (heading < 0) return true // No heading — fail open

        val bearing = bearingTo(userLat, userLng, camLat, camLng)
        var diff = abs(heading - bearing)
        if (diff > 180) diff = 360 - diff
        return diff <= MAX_BEARING_OFF_HEADING_DEGREES
    }

    // =========================================================================
    // Haversine / bearing math
    // =========================================================================

    private fun haversineDistance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371000.0 // Earth radius in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    }

    private fun bearingTo(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLng = Math.toRadians(lng2 - lng1)
        val lat1Rad = Math.toRadians(lat1)
        val lat2Rad = Math.toRadians(lat2)

        val y = sin(dLng) * cos(lat2Rad)
        val x = cos(lat1Rad) * sin(lat2Rad) - sin(lat1Rad) * cos(lat2Rad) * cos(dLng)

        val bearingRad = atan2(y, x)
        return (Math.toDegrees(bearingRad) + 360) % 360
    }

    // =========================================================================
    // TTS
    // =========================================================================

    private fun initTts() {
        if (tts != null) return

        tts = TextToSpeech(reactApplicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.US
                tts?.setSpeechRate(0.9f)
                ttsReady = true
                Log.i(TAG, "TTS initialized successfully")
            } else {
                Log.e(TAG, "TTS initialization failed with status: $status")
            }
        }
    }

    private fun doSpeak(message: String) {
        if (!ttsReady || tts == null) {
            Log.w(TAG, "TTS not ready, skipping speech: $message")
            return
        }

        try {
            // Duck other audio while speaking
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val params = android.os.Bundle().apply {
                    putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, alertVolume)
                }
                tts?.speak(message, TextToSpeech.QUEUE_FLUSH, params, "camera_alert_${System.currentTimeMillis()}")
            } else {
                @Suppress("DEPRECATION")
                tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null)
            }
            Log.d(TAG, "TTS speaking: $message")
        } catch (e: Exception) {
            Log.e(TAG, "TTS speak failed: ${e.message}")
        }
    }

    // =========================================================================
    // Notifications
    // =========================================================================

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Camera Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Speed and red-light camera proximity alerts"
                enableVibration(true)
                setShowBadge(true)
            }
            val manager = reactApplicationContext.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun fireNotification(camera: CameraDef, distance: Double) {
        try {
            val launchIntent = reactApplicationContext.packageManager
                .getLaunchIntentForPackage(reactApplicationContext.packageName)
            val pendingIntent = PendingIntent.getActivity(
                reactApplicationContext, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val title = if (camera.type == "redlight") "Red-light camera ahead" else "Speed camera ahead"
            val body = "${camera.address} (${distance.toInt()}m)"

            val notification = NotificationCompat.Builder(reactApplicationContext, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVibrate(longArrayOf(0, 250, 100, 250))
                .build()

            val manager = reactApplicationContext.getSystemService(NotificationManager::class.java)
            manager?.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fire notification: ${e.message}")
        }
    }

    // =========================================================================
    // JS event emission
    // =========================================================================

    private fun emitAlertEvent(camera: CameraDef, distance: Double, speed: Double) {
        try {
            val params = Arguments.createMap().apply {
                putString("cameraType", camera.type)
                putString("address", camera.address)
                putDouble("distance", distance)
                putDouble("speed", speed)
                putDouble("latitude", camera.lat)
                putDouble("longitude", camera.lng)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }

            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("NativeCameraAlert", params)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit camera alert event to JS: ${e.message}")
        }
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        try {
            tts?.stop()
            tts?.shutdown()
            tts = null
            ttsReady = false
        } catch (e: Exception) {
            Log.w(TAG, "Error shutting down TTS: ${e.message}")
        }
    }
}
