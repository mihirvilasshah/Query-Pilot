# syntax=docker/dockerfile:1
# Build context: services/schema-processor
#   docker build -t querypilot-schema-processor services/schema-processor

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first so the layer is cached until a project file changes.
COPY Directory.Build.props ./
COPY src/QueryPilot.SchemaProcessor.Core/QueryPilot.SchemaProcessor.Core.csproj src/QueryPilot.SchemaProcessor.Core/
COPY src/QueryPilot.SchemaProcessor.Worker/QueryPilot.SchemaProcessor.Worker.csproj src/QueryPilot.SchemaProcessor.Worker/
RUN dotnet restore src/QueryPilot.SchemaProcessor.Worker/QueryPilot.SchemaProcessor.Worker.csproj

COPY src/ src/
RUN dotnet publish src/QueryPilot.SchemaProcessor.Worker/QueryPilot.SchemaProcessor.Worker.csproj \
    -c Release -o /app/publish --no-restore /p:UseAppHost=false

# The worker has no public HTTP surface (the optional /healthz uses HttpListener from the shared runtime),
# so the plain runtime image is enough. Keep a Debian-based image: DacFx needs ICU culture data.
FROM mcr.microsoft.com/dotnet/runtime:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./

ENV DOTNET_ENVIRONMENT=Production \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false \
    DOTNET_gcServer=0

# Non-root user shipped with the official .NET images.
USER $APP_UID

ENTRYPOINT ["dotnet", "QueryPilot.SchemaProcessor.Worker.dll"]
