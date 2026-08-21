FROM golang:1.22-alpine AS build
WORKDIR /src
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/server ./server
ENV DB_PATH=/data/spend.db
ENV PORT=8080
VOLUME ["/data"]
EXPOSE 8080
CMD ["./server"]
