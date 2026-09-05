import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons

Panel {
  id: root
  moduleName: "custom.omarchy-companion"
  ipcTarget: "custom.omarchy-companion"
  manageIpc: false

  readonly property string companion: Qt.resolvedUrl("../../../../.local/share/omarchy-companion/companion").toString().replace(/^file:\/\//, "")
  property bool online: false
  property bool hasClient: false
  property int clientCount: 0
  property string tailscaleUrl: ""
  property string localUrl: ""
  property string primaryUrl: ""
  property string statusMessage: "Checking server..."
  property bool autostart: false
  property string qrPath: ""
  property string recentLogs: ""
  property string currentTab: "connect"
  property int copySuccessId: 0
  property int refreshKey: 0

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function restartServer() {
    if (!restartProc.running) restartProc.running = true
  }

  function toggleServer() {
    if (root.online) {
      if (!stopProc.running) stopProc.running = true
    } else {
      if (!startProc.running) startProc.running = true
    }
  }

  function toggleAutostart() {
    if (!autostartProc.running) autostartProc.running = true
  }

  function copyText(val, id) {
    if (!val) return
    copyProc.command = ["wl-copy", val]
    copyProc.running = true
    root.copySuccessId = id
    copyTimer.restart()
  }

  function openBrowser() {
    var url = root.primaryUrl || root.tailscaleUrl || root.localUrl
    if (url !== "") Qt.openUrlExternally(url)
  }

  Component.onCompleted: refresh()
  onOpenedChanged: if (opened) refresh()

  Timer {
    interval: 4000
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Timer {
    id: copyTimer
    interval: 2000
    repeat: false
    onTriggered: root.copySuccessId = 0
  }

  Process {
    id: statusProc
    command: [root.companion, "panel-status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          const data = JSON.parse(String(text || ""))
          root.online = Boolean(data.running)
          root.hasClient = Boolean(data.hasClient)
          root.clientCount = Number(data.clientCount || 0)
          root.tailscaleUrl = String(data.tailscaleUrl || "")
          root.localUrl = String(data.localUrl || "")
          root.primaryUrl = String(data.primaryUrl || data.tailscaleUrl || data.localUrl || "")
          root.autostart = Boolean(data.autostart)
          root.qrPath = String(data.qrPath || "")
          root.recentLogs = String(data.recentLogs || "")
          root.refreshKey = root.refreshKey + 1

          if (!root.online) {
            root.statusMessage = "Server is stopped"
          } else if (root.hasClient) {
            root.statusMessage = "Connected: " + root.clientCount + (root.clientCount === 1 ? " phone" : " phones")
          } else {
            root.statusMessage = "Server ready — scan QR to connect"
          }
        } catch (e) {
          root.statusMessage = "Could not reach companion service"
        }
      }
    }
  }

  Process {
    id: copyProc
    stdout: StdioCollector { waitForEnd: true }
  }

  Process {
    id: restartProc
    command: ["systemctl", "--user", "restart", "omarchy-companion.service"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.refresh()
    }
  }

  Process {
    id: stopProc
    command: ["systemctl", "--user", "stop", "omarchy-companion.service"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.refresh()
    }
  }

  Process {
    id: startProc
    command: ["systemctl", "--user", "start", "omarchy-companion.service"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.refresh()
    }
  }

  Process {
    id: autostartProc
    command: [root.companion, "autostart-toggle"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.refresh()
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.online ? (root.hasClient ? "󰄜" : "󰀂") : "󰀃"
    color: root.hasClient ? Color.accent : root.bar.foreground
    onPressed: function(button) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    contentWidth: panel.fittedContentWidth(Style.space(350))
    contentHeight: panel.fittedContentHeight(content.implicitHeight, Style.space(480))

    Column {
      id: content
      width: parent.width
      spacing: Style.space(12)

      // Header Row
      Item {
        width: parent.width
        implicitHeight: Style.space(32)

        Row {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(8)

          Text {
            text: "󰄜"
            color: Color.accent
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.title
            anchors.verticalCenter: parent.verticalCenter
          }

          Text {
            text: "Omarchy Companion"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
            anchors.verticalCenter: parent.verticalCenter
          }
        }

        Rectangle {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          radius: Style.space(4)
          width: statusText.implicitWidth + Style.space(14)
          height: Style.space(22)
          color: root.online ? (root.hasClient ? "#22c55e" : "#3b82f6") : "#ef4444"

          Text {
            id: statusText
            anchors.centerIn: parent
            text: root.online ? (root.hasClient ? "Connected" : "Running") : "Stopped"
            color: "#ffffff"
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }
        }
      }

      Text {
        width: parent.width
        text: root.statusMessage
        wrapMode: Text.Wrap
        color: root.hasClient ? Color.accent : Qt.darker(root.bar.foreground, 1.3)
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.body
      }

      // Tab Switcher
      Row {
        width: parent.width
        spacing: Style.space(6)

        // Tab: Connect
        Rectangle {
          width: (parent.width - Style.space(12)) / 3
          height: Style.space(30)
          radius: Style.space(4)
          color: root.currentTab === "connect" ? Color.accent : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: "󰄜 Connect"
            color: root.currentTab === "connect" ? "#ffffff" : root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.currentTab = "connect"
          }
        }

        // Tab: Service
        Rectangle {
          width: (parent.width - Style.space(12)) / 3
          height: Style.space(30)
          radius: Style.space(4)
          color: root.currentTab === "service" ? Color.accent : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: "󰐥 Service"
            color: root.currentTab === "service" ? "#ffffff" : root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.currentTab = "service"
          }
        }

        // Tab: Logs
        Rectangle {
          width: (parent.width - Style.space(12)) / 3
          height: Style.space(30)
          radius: Style.space(4)
          color: root.currentTab === "logs" ? Color.accent : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)

          Text {
            anchors.centerIn: parent
            text: "󰋼 Logs"
            color: root.currentTab === "logs" ? "#ffffff" : root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.currentTab = "logs"
          }
        }
      }

      PanelSeparator { width: parent.width; foreground: root.bar.foreground }

      // ==================== TAB 1: CONNECT & QR ====================
      Column {
        width: parent.width
        spacing: Style.space(10)
        visible: root.currentTab === "connect"

        // QR Code Card
        Rectangle {
          width: Style.space(160)
          height: Style.space(160)
          radius: Style.space(8)
          color: "#ffffff"
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.online && root.qrPath !== ""

          Image {
            anchors.fill: parent
            anchors.margins: Style.space(8)
            source: root.qrPath !== "" ? ("file://" + root.qrPath + "?v=" + root.refreshKey) : ""
            fillMode: Image.PreserveAspectFit
            cache: false
            smooth: false
          }
        }

        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          text: root.online ? "Scan with phone camera to open dashboard" : "Start server to enable phone connection"
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }

        // Tailscale URL with Copy Button
        Column {
          width: parent.width
          spacing: Style.space(4)
          visible: root.tailscaleUrl !== ""

          Text {
            text: "TAILSCALE (RECOMMENDED)"
            color: Qt.darker(root.bar.foreground, 1.5)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Rectangle {
            width: parent.width
            height: Style.space(38)
            radius: Style.space(6)
            color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)

            Row {
              anchors.fill: parent
              anchors.margins: Style.space(8)
              spacing: Style.space(8)

              Text {
                id: tsUrlText
                width: parent.width - copyTsBtn.width - Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: root.tailscaleUrl
                color: Color.accent
                font.family: "monospace"
                font.pixelSize: Style.font.caption
                font.bold: true
                elide: Text.ElideRight
              }

              Rectangle {
                id: copyTsBtn
                width: Style.space(70)
                height: Style.space(24)
                radius: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                color: root.copySuccessId === 1 ? "#22c55e" : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)

                Text {
                  anchors.centerIn: parent
                  text: root.copySuccessId === 1 ? "󰄬 Copied" : "󰆏 Copy"
                  color: root.copySuccessId === 1 ? "#ffffff" : root.bar.foreground
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                }

                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.copyText(root.tailscaleUrl, 1)
                }
              }
            }
          }
        }

        // Local Wi-Fi URL with Copy Button
        Column {
          width: parent.width
          spacing: Style.space(4)
          visible: root.localUrl !== "" && root.localUrl !== root.tailscaleUrl

          Text {
            text: "LOCAL WI-FI / LAN"
            color: Qt.darker(root.bar.foreground, 1.5)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Rectangle {
            width: parent.width
            height: Style.space(38)
            radius: Style.space(6)
            color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.05)

            Row {
              anchors.fill: parent
              anchors.margins: Style.space(8)
              spacing: Style.space(8)

              Text {
                width: parent.width - copyLanBtn.width - Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: root.localUrl
                color: root.bar.foreground
                font.family: "monospace"
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }

              Rectangle {
                id: copyLanBtn
                width: Style.space(70)
                height: Style.space(24)
                radius: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                color: root.copySuccessId === 2 ? "#22c55e" : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)

                Text {
                  anchors.centerIn: parent
                  text: root.copySuccessId === 2 ? "󰄬 Copied" : "󰆏 Copy"
                  color: root.copySuccessId === 2 ? "#ffffff" : root.bar.foreground
                  font.family: root.bar.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                }

                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.copyText(root.localUrl, 2)
                }
              }
            }
          }
        }
      }

      // ==================== TAB 2: SERVICE & CONTROLS ====================
      Column {
        width: parent.width
        spacing: Style.space(10)
        visible: root.currentTab === "service"

        // Auto-start on boot row
        Rectangle {
          width: parent.width
          height: Style.space(44)
          radius: Style.space(6)
          color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.06)

          Row {
            anchors.fill: parent
            anchors.margins: Style.space(10)

            Column {
              width: parent.width - autostartBadge.width - Style.space(10)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              Text {
                text: "Auto-Start at Boot"
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
              }

              Text {
                text: "Starts automatically on system boot"
                color: Qt.darker(root.bar.foreground, 1.4)
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            Rectangle {
              id: autostartBadge
              width: Style.space(74)
              height: Style.space(24)
              radius: Style.space(12)
              anchors.verticalCenter: parent.verticalCenter
              color: root.autostart ? "#22c55e" : Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.15)

              Text {
                anchors.centerIn: parent
                text: root.autostart ? "Enabled" : "Disabled"
                color: root.autostart ? "#ffffff" : root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
              }
            }
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.toggleAutostart()
          }
        }

        // Restart Server Button
        CursorSurface {
          width: parent.width
          implicitHeight: Style.space(38)
          foreground: root.bar.foreground
          fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
          Text {
            anchors.centerIn: parent
            text: "󰜉  Restart Companion Server"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.bold: true
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.restartServer()
          }
        }

        // Start / Stop Server Button
        CursorSurface {
          width: parent.width
          implicitHeight: Style.space(38)
          foreground: root.bar.foreground
          fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
          Text {
            anchors.centerIn: parent
            text: root.online ? "󰅖  Stop Server" : "󰐥  Start Server"
            color: root.online ? "#ef4444" : "#22c55e"
            font.family: root.bar.fontFamily
            font.bold: true
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.toggleServer()
          }
        }

        // Open in Browser
        CursorSurface {
          visible: root.primaryUrl !== ""
          width: parent.width
          implicitHeight: Style.space(36)
          foreground: root.bar.foreground
          fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
          Text {
            anchors.centerIn: parent
            text: "󰈹  Open Companion in Browser"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.openBrowser()
          }
        }
      }

      // ==================== TAB 3: LOGS & DIAGNOSTICS ====================
      Column {
        width: parent.width
        spacing: Style.space(8)
        visible: root.currentTab === "logs"

        Text {
          text: "RECENT SERVICE ACTIVITY"
          color: Qt.darker(root.bar.foreground, 1.5)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Rectangle {
          width: parent.width
          height: Style.space(140)
          radius: Style.space(6)
          color: Qt.rgba(0, 0, 0, 0.35)
          clip: true

          ScrollView {
            anchors.fill: parent
            anchors.margins: Style.space(8)

            Text {
              width: parent.width
              text: root.recentLogs || "No recent activity recorded."
              color: root.bar.foreground
              font.family: "monospace"
              font.pixelSize: Style.font.caption
              wrapMode: Text.WrapAnywhere
            }
          }
        }

        CursorSurface {
          width: parent.width
          implicitHeight: Style.space(32)
          foreground: root.bar.foreground
          fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
          Text {
            anchors.centerIn: parent
            text: "󰑐  Refresh Status & Logs"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.refresh()
          }
        }
      }
    }
  }
}
