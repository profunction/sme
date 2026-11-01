import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override String toString() => message;
}

Uri validateServer(String input, {bool allowDevelopmentHttp = false}) {
  final uri = Uri.parse(input.trim());
  if (!uri.hasAuthority || uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment || (uri.path.isNotEmpty && uri.path != '/')) {
    throw FormatException('Use an API origin without credentials, path, query or fragment.');
  }
  final local = ['localhost', '127.0.0.1', '10.0.2.2', '::1'].contains(uri.host);
  if (uri.scheme != 'https' && !(allowDevelopmentHttp && uri.scheme == 'http' && local)) {
    throw FormatException('Use HTTPS. HTTP is available only in explicit emulator development builds.');
  }
  return uri.replace(path: '');
}

class FieldApi {
  final Uri origin;
  final String? token;
  final http.Client client;
  FieldApi(this.origin, {this.token, http.Client? client}) : client = client ?? http.Client();

  Future<http.Response> send(String path, {String method = 'GET', Object? body}) async {
    final request = http.Request(method, origin.resolve(path));
    request.followRedirects = false;
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final streamed = await client.send(request).timeout(const Duration(seconds: 20));
    final bytes = BytesBuilder();
    await for (final chunk in streamed.stream.timeout(const Duration(seconds: 30))) {
      bytes.add(chunk);
      if (bytes.length > 12 * 1024 * 1024) throw ApiException(413, 'Response exceeds the mobile cache limit.');
    }
    final response = http.Response.bytes(bytes.takeBytes(), streamed.statusCode, headers: streamed.headers);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = 'Server returned ${response.statusCode}';
      try {
        final detail = (jsonDecode(response.body) as Map)['detail'];
        message = detail is String ? detail : (detail is Map ? '${detail['message'] ?? message}' : message);
      } catch (_) {}
      throw ApiException(response.statusCode, message);
    }
    return response;
  }

  Future<dynamic> json(String path, {String method = 'GET', Object? body}) async {
    final response = await send(path, method: method, body: body);
    return response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
  }
  void close() => client.close();
}
