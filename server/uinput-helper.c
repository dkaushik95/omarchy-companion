#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <linux/uinput.h>

static void emit(int fd, int type, int code, int val) {
    struct input_event ie;
    memset(&ie, 0, sizeof(ie));
    ie.type = type;
    ie.code = code;
    ie.value = val;
    write(fd, &ie, sizeof(ie));
}

int main() {
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) {
        perror("open /dev/uinput");
        return 1;
    }

    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(fd, UI_SET_KEYBIT, BTN_MIDDLE);

    ioctl(fd, UI_SET_EVBIT, EV_REL);
    ioctl(fd, UI_SET_RELBIT, REL_X);
    ioctl(fd, UI_SET_RELBIT, REL_Y);
    ioctl(fd, UI_SET_RELBIT, REL_WHEEL);
    ioctl(fd, UI_SET_RELBIT, REL_HWHEEL);

    struct uinput_setup usetup;
    memset(&usetup, 0, sizeof(usetup));
    usetup.id.bustype = BUS_USB;
    usetup.id.vendor = 0x1234;
    usetup.id.product = 0x5678;
    strcpy(usetup.name, "Omarchy Companion Virtual Mouse");

    if (ioctl(fd, UI_DEV_SETUP, &usetup) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) {
        perror("init device");
        close(fd);
        return 1;
    }

    setvbuf(stdout, NULL, _IONBF, 0);
    printf("READY\n");

    char line[256];
    while (fgets(line, sizeof(line), stdin)) {
        char cmd[32];
        int a = 0, b = 0;
        int count = sscanf(line, "%31s %d %d", cmd, &a, &b);
        if (count < 1) continue;

        if (strcmp(cmd, "move") == 0) {
            emit(fd, EV_REL, REL_X, a);
            emit(fd, EV_REL, REL_Y, b);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "scroll") == 0) {
            emit(fd, EV_REL, REL_WHEEL, a);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "hscroll") == 0) {
            emit(fd, EV_REL, REL_HWHEEL, a);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "click") == 0) {
            int btn = (a == 1) ? BTN_RIGHT : (a == 2) ? BTN_MIDDLE : BTN_LEFT;
            emit(fd, EV_KEY, btn, 1);
            emit(fd, EV_SYN, SYN_REPORT, 0);
            usleep(15000);
            emit(fd, EV_KEY, btn, 0);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "double_click") == 0) {
            int btn = BTN_LEFT;
            emit(fd, EV_KEY, btn, 1);
            emit(fd, EV_SYN, SYN_REPORT, 0);
            usleep(15000);
            emit(fd, EV_KEY, btn, 0);
            emit(fd, EV_SYN, SYN_REPORT, 0);
            usleep(40000);
            emit(fd, EV_KEY, btn, 1);
            emit(fd, EV_SYN, SYN_REPORT, 0);
            usleep(15000);
            emit(fd, EV_KEY, btn, 0);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "down") == 0) {
            int btn = (a == 1) ? BTN_RIGHT : (a == 2) ? BTN_MIDDLE : BTN_LEFT;
            emit(fd, EV_KEY, btn, 1);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "up") == 0) {
            int btn = (a == 1) ? BTN_RIGHT : (a == 2) ? BTN_MIDDLE : BTN_LEFT;
            emit(fd, EV_KEY, btn, 0);
            emit(fd, EV_SYN, SYN_REPORT, 0);
        } else if (strcmp(cmd, "ping") == 0) {
            printf("pong\n");
        }
    }

    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return 0;
}
