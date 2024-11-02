##
## Build Lowcoder api-service application
##
FROM maven:3.9-eclipse-temurin-17 AS build-api-service

# Build lowcoder-api
COPY ./server/api-service /lowcoder-server
WORKDIR /lowcoder-server
RUN --mount=type=cache,target=/root/.m2 mvn -f pom.xml clean package -DskipTests

# Create required folder structure
RUN mkdir -p /lowcoder/api-service/config /lowcoder/api-service/logs /lowcoder/plugins

# Copy lowcoder server configuration
COPY server/api-service/lowcoder-server/src/main/resources/application.yaml /lowcoder/api-service/config/

# Add bootstrap and startup files
COPY deploy/docker/api-service/entrypoint.sh /lowcoder/api-service/entrypoint.sh
COPY deploy/docker/api-service/init.sh /lowcoder/api-service/init.sh
RUN chmod +x /lowcoder/api-service/*.sh

##
## Intermediary Lowcoder api-service image
##
FROM eclipse-temurin:17-jammy AS lowcoder-ce-api-service
LABEL maintainer="lowcoder"

RUN apt-get update && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/cache/apt/lists \
  && addgroup --system --gid 9001 lowcoder \
  && adduser --system --disabled-password --no-create-home --uid 9001 --gid 9001 lowcoder

# Copy lowcoder server configuration
COPY --chown=lowcoder:lowcoder --from=build-api-service /lowcoder/api-service /lowcoder/api-service

# Copy lowcoder api service app, dependencies and libs
COPY --chown=lowcoder:lowcoder --from=build-api-service /lowcoder-server/lowcoder-server/target/lowcoder-api-service-bin/lowcoder-api-service.jar /lowcoder/api-service/lowcoder-api-service.jar
COPY --chown=lowcoder:lowcoder --from=build-api-service /lowcoder-server/lowcoder-server/target/lowcoder-api-service-bin/libs /lowcoder/api-service/libs
COPY --chown=lowcoder:lowcoder --from=build-api-service /lowcoder-server/lowcoder-server/target/lowcoder-api-service-bin/plugins /lowcoder/api-service/plugins

EXPOSE 8080
CMD [ "/bin/bash" , "/lowcoder/api-service/entrypoint.sh" ]

#############################################################################

## Build Lowcoder node service
FROM ubuntu:jammy AS build-node-service

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y curl ca-certificates build-essential gnupg

# Add nodejs repo and keys
RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# Download nodejs and install yarn
RUN apt-get update \
  && apt-get install --no-install-recommends -y nodejs \
  && npm install -g yarn

# Copy and build the node-service app
COPY server/node-service/ /lowcoder/node-service/app/
WORKDIR /lowcoder/node-service/app/
RUN yarn --immutable
RUN yarn build

# Copy startup script
COPY deploy/docker/node-service/entrypoint.sh /lowcoder/node-service/entrypoint.sh
COPY deploy/docker/node-service/init.sh /lowcoder/node-service/init.sh
RUN chmod +x /lowcoder/node-service/*.sh

##
## Intermediary Lowcoder node service image
##
FROM ubuntu:jammy AS lowcoder-ce-node-service
LABEL maintainer="lowcoder"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y curl ca-certificates gnupg

# Add nodejs repo and keys
RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# Download nodejs and install yarn
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y nodejs gosu \
  && npm install -g yarn \
  && rm -rf /var/cache/apt/lists 

COPY --from=build-node-service /lowcoder/node-service /lowcoder/node-service

EXPOSE 6060
CMD [ "/bin/sh", "/lowcoder/node-service/entrypoint.sh" ]

#############################################################################

## Build Lowcoder all-in-one image
FROM ubuntu:jammy
LABEL maintainer="lowcoder"

# Install essential tools
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y curl ca-certificates gnupg bash lsb-release \
  && rm -rf /var/cache/apt/lists 

# Add required apt repositories and signing keys
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/nodesource-keyring.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# Install required packages
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y install --no-install-recommends -y \
      nginx=1.27.1-1~jammy \
      mongodb-org \
      redis \
      supervisor \
      gosu \
      nodejs \
  && npm install -g yarn \
  && rm -rf /var/cache/apt/lists 

# Add lowcoder user
RUN useradd -m --uid 9001 -r lowcoder \
  && usermod --login lowcoder --uid 9001 nginx \
  && groupmod --new-name lowcoder --gid 9001 nginx

# Copy additional nginx init scripts and configs
# Ensure you have the files in the correct locations
COPY deploy/docker/all-in-one/entrypoint.sh /lowcoder/entrypoint.sh
COPY --chown=lowcoder:lowcoder --from=lowcoder-ce-api-service /lowcoder/api-service /lowcoder/api-service
COPY --chown=lowcoder:lowcoder --from=lowcoder-ce-node-service /lowcoder/node-service /lowcoder/node-service

# Set entrypoint for the all-in-one image
ENTRYPOINT [ "/bin/sh", "/lowcoder/entrypoint.sh" ]
CMD ["/usr/bin/supervisord", "-n" , "-c" , "/lowcoder/etc/supervisord.conf"]

# Expose service ports
EXPOSE 27017
EXPOSE 3000
EXPOSE 3443
