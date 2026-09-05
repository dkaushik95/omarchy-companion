import QtQuick
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

  function openBrowser() {
    var url = root.primaryUrl || root.tailscaleUrl || root.localUrl
    if (url !== "") Qt.openUrlExternally(url)
  }

  Component.onCompleted: refresh()
  onOpenedChanged: if (opened) refresh()

  Timer {
    interval: 5000
    running: true
    repeat: true
    onTriggered: root.refresh()
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

          if (!root.online) {
            root.statusMessage = "Server is stopped"
          } else if (root.hasClient) {
            root.statusMessage = "Connected: " + root.clientCount + (root.clientCount === 1 ? " phone" : " phones")
          } else {
            root.statusMessage = "Server running — waiting for phone"
          }
        } catch (e) {
          root.statusMessage = "Could not reach companion service"
        }
      }
    }
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
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    Column {
      id: content
      width: parent.width
      spacing: Style.space(10)

      // Header Row
      Row {
        width: parent.width
        spacing: Style.space(8)

        Text {
          text: "Omarchy Companion"
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
          anchors.verticalCenter: parent.verticalCenter
        }

        Item { width: 1; height: 1; Layout.fillWidth: true }

        Rectangle {
          radius: Style.space(4)
          width: statusText.implicitWidth + Style.space(14)
          height: Style.space(22)
          color: root.online ? (root.hasClient ? "#22c55e" : "#3b82f6") : "#ef4444"
          anchors.verticalCenter: parent.verticalCenter

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

      PanelSeparator { width: parent.width; foreground: root.bar.foreground }

      // Tailscale URL
      Column {
        width: parent.width
        spacing: Style.space(4)
        visible: root.tailscaleUrl !== ""

        Text {
          text: "TAILSCALE (PHONE URL)"
          color: Qt.darker(root.bar.foreground, 1.5)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Rectangle {
          width: parent.width
          implicitHeight: Style.space(38)
          radius: Style.space(6)
          color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.08)

          Row {
            anchors.fill: parent
            anchors.margins: Style.space(8)
            spacing: Style.space(8)

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.tailscaleUrl
              color: Color.accent
              font.family: "monospace"
              font.pixelSize: Style.font.body
              font.bold: true
            }
          }
        }
      }

      // Local LAN URL
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
          implicitHeight: Style.space(34)
          radius: Style.space(6)
          color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.05)

          Text {
            anchors.centerIn: parent
            text: root.localUrl
            color: root.bar.foreground
            font.family: "monospace"
            font.pixelSize: Style.font.caption
          }
        }
      }

      PanelSeparator { width: parent.width; foreground: root.bar.foreground }

      // Restart Server Button
      CursorSurface {
        width: parent.width
        implicitHeight: Style.space(38)
        foreground: root.bar.foreground
        fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
        Text {
          anchors.centerIn: parent
          text: "󰜉  Restart Server"
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

      // Close / Start Server Button
      CursorSurface {
        width: parent.width
        implicitHeight: Style.space(38)
        foreground: root.bar.foreground
        fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
        Text {
          anchors.centerIn: parent
          text: root.online ? "󰅖  Close Server" : "󰐥  Start Server"
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

      // Open on PC Button
      CursorSurface {
        visible: root.primaryUrl !== ""
        width: parent.width
        implicitHeight: Style.space(36)
        foreground: root.bar.foreground
        fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
        Text {
          anchors.centerIn: parent
          text: "Open Companion in Browser"
          color: root.bar.foreground
          font.family: root.bar.fontFamily
        }
        MouseArea {
          anchors.fill: parent
          cursorShape: Qt.PointingHandCursor
          onClicked: root.openBrowser()
        }
      }

      // Refresh Button
      CursorSurface {
        width: parent.width
        implicitHeight: Style.space(32)
        foreground: root.bar.foreground
        fill: Style.hoverFillFor(root.bar.foreground, Color.accent)
        Text {
          anchors.centerIn: parent
          text: "Refresh Status"
          color: Qt.darker(root.bar.foreground, 1.4)
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
