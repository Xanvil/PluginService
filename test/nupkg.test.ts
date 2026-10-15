import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  parseNuspecXml,
  parseTags,
  readMetadata,
  readPackage,
} from "../src/nuget/nupkg";

const sampleNuspec = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>Demo.Lib</id>
    <version>1.2.3</version>
    <authors>Alice</authors>
    <description>A demo package</description>
    <tags>plugin CorelDraw extension</tags>
    <releaseNotes><![CDATA[## 1.2.3
- Fix crash
- Add API]]></releaseNotes>
    <readme>docs/README.md</readme>
    <icon>images/icon.png</icon>
    <projectUrl>https://example.com/demo</projectUrl>
    <dependencies>
      <group targetFramework="net8.0">
        <dependency id="Newtonsoft.Json" version="13.0.1" />
      </group>
    </dependencies>
  </metadata>
</package>`;

/** 最小合法 PNG（1x1） */
const tinyPng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02,
  0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

describe("parseNuspecXml", () => {
  it("解析 id/version/依赖", () => {
    const meta = parseNuspecXml(sampleNuspec);
    expect(meta.id).toBe("Demo.Lib");
    expect(meta.version).toBe("1.2.3");
    expect(meta.authors).toBe("Alice");
    expect(meta.dependencyGroups).toHaveLength(1);
    expect(meta.dependencyGroups[0]!.targetFramework).toBe("net8.0");
    expect(meta.dependencyGroups[0]!.dependencies[0]!.id).toBe(
      "Newtonsoft.Json",
    );
  });

  it("解析 releaseNotes / readme / icon / tags / projectUrl", () => {
    const meta = parseNuspecXml(sampleNuspec);
    expect(meta.releaseNotes).toContain("Fix crash");
    expect(meta.readmeFile).toBe("docs/README.md");
    expect(meta.iconFile).toBe("images/icon.png");
    expect(meta.projectUrl).toBe("https://example.com/demo");
    expect(meta.tags).toEqual(["plugin", "CorelDraw", "extension"]);
  });

  it("CDATA 内含伪闭合标签时仍完整解析 releaseNotes", () => {
    const xml = `<?xml version="1.0"?>
<package><metadata>
  <id>Y</id><version>1.0.0</version><description>d</description>
  <releaseNotes><![CDATA[Fixed </releaseNotes> in docs
More notes]]></releaseNotes>
</metadata></package>`;
    const meta = parseNuspecXml(xml);
    expect(meta.releaseNotes).toContain("Fixed </releaseNotes> in docs");
    expect(meta.releaseNotes).toContain("More notes");
  });

  it("解析带数字实体的 releaseNotes", () => {
    const xml = `<?xml version="1.0"?>
<package><metadata>
  <id>Z</id><version>1.0.0</version><description>d</description>
  <releaseNotes>line1&#xA;line2&#10;done</releaseNotes>
</metadata></package>`;
    const meta = parseNuspecXml(xml);
    expect(meta.releaseNotes).toContain("line1");
    expect(meta.releaseNotes).toContain("line2");
    expect(meta.releaseNotes).toContain("done");
  });
});

describe("parseTags", () => {
  it("解析逗号与空格标签", () => {
    expect(parseTags("a, b;c  a")).toEqual(["a", "b", "c"]);
  });
});

describe("readPackage", () => {
  it("从 zip nupkg 读取 nuspec、README 与图标", () => {
    const zipped = zipSync({
      "Demo.Lib.nuspec": new TextEncoder().encode(sampleNuspec),
      "docs/README.md": new TextEncoder().encode(
        "# Demo\n\nHello **world**.\n",
      ),
      "images/icon.png": tinyPng,
    });
    const { meta, icon } = readPackage(zipped);
    expect(meta.id).toBe("Demo.Lib");
    expect(meta.readme).toContain("Hello **world**");
    expect(meta.releaseNotes).toContain("Add API");
    expect(icon?.contentType).toBe("image/png");
    expect(icon?.extension).toBe("png");
    expect(icon?.bytes.byteLength).toBeGreaterThan(0);
  });

  it("无 readme 声明时回退根目录 README.md", () => {
    const nuspec = `<?xml version="1.0"?>
<package><metadata>
  <id>X</id><version>1.0.0</version><description>d</description>
</metadata></package>`;
    const zipped = zipSync({
      "X.nuspec": new TextEncoder().encode(nuspec),
      "README.md": new TextEncoder().encode("# Fallback readme"),
    });
    const meta = readMetadata(zipped);
    expect(meta.readme).toBe("# Fallback readme");
  });

  it("nuspec 无 releaseNotes 时回退 CHANGELOG.md", () => {
    const nuspec = `<?xml version="1.0"?>
<package><metadata>
  <id>X</id><version>1.0.0</version><description>d</description>
</metadata></package>`;
    const zipped = zipSync({
      "X.nuspec": new TextEncoder().encode(nuspec),
      "CHANGELOG.md": new TextEncoder().encode("## 1.0.0\n\n- first release\n"),
    });
    const meta = readMetadata(zipped);
    expect(meta.releaseNotes).toContain("first release");
  });
});
