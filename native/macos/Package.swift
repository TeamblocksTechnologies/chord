// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "recorder-helper",
    platforms: [.macOS(.v14)],
    dependencies: [
        // Runs Parakeet. Without its default trait, which links a text normalizer only its speech synthesis uses.
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7", traits: [])
    ],
    targets: [
        .target(name: "RecorderCore"),
        .executableTarget(
            name: "recorder-helper",
            dependencies: ["RecorderCore"],
            linkerSettings: [
                // Embed Info.plist so macOS can show usage descriptions for TCC permissions.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Resources/Info.plist",
                ])
            ]
        ),
        .executableTarget(
            name: "transcriber-helper",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Resources/transcriber-helper-Info.plist",
                ])
            ]
        ),
        .executableTarget(name: "background-helper"),
        .executableTarget(name: "audio-helper"),
        .testTarget(
            name: "RecorderCoreTests",
            dependencies: ["RecorderCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
