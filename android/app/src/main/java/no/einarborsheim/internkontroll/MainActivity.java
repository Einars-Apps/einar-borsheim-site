package no.einarborsheim.internkontroll;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Tving klassisk (ikke edge-to-edge) visning slik at system-navigasjonslinjen
    // alltid er synlig og trykkbar, uavhengig av Capacitor sin standardoppførsel.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
  }
}
