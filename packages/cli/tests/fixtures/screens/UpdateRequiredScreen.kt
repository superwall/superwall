package com.acme.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.acme.app.R
import com.google.android.play.core.review.ReviewManagerFactory

const val STORE_URL = "https://play.google.com/store/apps/details?id=com.acme.app"
const val PRODUCT_ID = "acme_pro_annual"

// Blocks the app until the user updates.
@Composable
fun UpdateRequiredScreen(minimumVersion: String, onLater: () -> Unit) {
    val context = LocalContext.current
    Column {
        Image(painter = painterResource(R.drawable.rocket), contentDescription = "Rocket")
        Icon(Icons.Default.SystemUpdate, contentDescription = null)
        Text(text = stringResource(R.string.update_required_title))
        Text(text = "Version $minimumVersion fixes sign-in. Update to keep using Acme.")
        Button(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(STORE_URL))) }) {
            Text("Update now")
        }
        TextButton(onClick = onLater) { Text("Remind me later") }
    }
}
