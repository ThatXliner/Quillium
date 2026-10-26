// oauth_loopback_probe.c — Verifies that a sandbox policy permits a loopback listener.

#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(void) {
    int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (socket_fd == -1) {
        fprintf(stderr, "socket: %s\n", strerror(errno));
        return 1;
    }

    struct sockaddr_in address = {
        .sin_family = AF_INET,
        .sin_port = htons(0),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK),
    };

    if (bind(socket_fd, (struct sockaddr *)&address, sizeof(address)) == -1) {
        fprintf(stderr, "bind: %s (os error %d)\n", strerror(errno), errno);
        close(socket_fd);
        return 1;
    }

    close(socket_fd);
    return 0;
}
